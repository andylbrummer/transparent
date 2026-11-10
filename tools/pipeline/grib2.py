"""A small GRIB2 reader: just enough for NOAA GFS fields on a lat/lon grid.

Decodes one message with grid template 3.0 (regular latitude/longitude) and
data representation 5.0 (simple packing), 5.2 (complex packing) or 5.3
(complex packing with spatial differencing) - what NCEP writes for the
pgrb2 files - with no bitmap and no missing values. Anything else raises:
a wrong field must never pass for a right one.

The layout follows WMO Manual on Codes I.2 (FM 92 GRIB edition 2) and NCEP's
g2c unpacker (comunpack.c). app/src/layers/weather/grib2.ts is the same
reader in TypeScript, for the live fetch; test_weather_snapshot.py checks
this one against values from an independent decoder.

Standard library and numpy only.
"""

import struct
from dataclasses import dataclass

import numpy as np


class Grib2Error(ValueError):
    pass


@dataclass
class Grib2Field:
    discipline: int
    category: int
    number: int
    #: Reference time of the model run, ISO 8601 UTC.
    reference_time: str
    #: Hours from the reference time to the valid time.
    forecast_hours: int
    #: Type and value of the first fixed surface (100 = isobaric, Pa; 103 = metres above ground).
    level_type: int
    level_value: float
    ni: int
    nj: int
    lat_first: float
    lon_first: float
    lat_step: float
    lon_step: float
    #: Row-major, nj rows of ni, in the file's own scan order (see lat_first/lat_step).
    values: np.ndarray


def _signed(value: int, bits: int) -> int:
    """GRIB's sign-and-magnitude integers: the top bit is the sign."""
    sign = 1 << (bits - 1)
    return -(value & (sign - 1)) if value & sign else value


def _read_bits(data: bytes, bit_offset: int, width: int, count: int) -> np.ndarray:
    """`count` unsigned big-endian integers of `width` bits each, starting at `bit_offset`."""
    if width == 0 or count == 0:
        return np.zeros(count, dtype=np.int64)
    first = bit_offset // 8
    last = (bit_offset + width * count + 7) // 8
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8, count=last - first, offset=first))
    start = bit_offset - first * 8
    table = bits[start : start + width * count].reshape(count, width).astype(np.int64)
    weights = 1 << np.arange(width - 1, -1, -1, dtype=np.int64)
    return table @ weights


def _sections(message: bytes) -> dict[int, bytes]:
    if message[:4] != b"GRIB" or message[7] != 2:
        raise Grib2Error("not a GRIB edition 2 message")
    total = struct.unpack(">Q", message[8:16])[0]
    sections: dict[int, bytes] = {0: message[:16]}
    offset = 16
    while offset < total - 4:
        length = struct.unpack(">I", message[offset : offset + 4])[0]
        number = message[offset + 4]
        if number in sections:
            raise Grib2Error("more than one field in the message")
        sections[number] = message[offset : offset + length]
        offset += length
    if message[offset : offset + 4] != b"7777":
        raise Grib2Error("message does not end in 7777")
    return sections


def _unpack_complex(section5: bytes, section7: bytes, template: int, count: int) -> np.ndarray:
    """Data representation templates 5.2 and 5.3, as integers before scaling."""
    nbits = section5[19]
    if section5[22] != 0:
        raise Grib2Error("missing-value management is not supported")
    groups = struct.unpack(">I", section5[31:35])[0]
    width_ref = section5[35]
    width_bits = section5[36]
    length_ref = struct.unpack(">I", section5[37:41])[0]
    length_inc = section5[41]
    last_length = struct.unpack(">I", section5[42:46])[0]
    length_bits = section5[46]
    order = section5[47] if template == 3 else 0
    extra_octets = section5[48] if template == 3 else 0

    position = 5
    initial: list[int] = []
    minimum = 0
    if template == 3:
        if order not in (1, 2) or extra_octets == 0:
            raise Grib2Error(f"spatial differencing of order {order} is not supported")
        for _ in range(order):
            raw = int.from_bytes(section7[position : position + extra_octets], "big")
            initial.append(_signed(raw, extra_octets * 8))
            position += extra_octets
        minimum = _signed(int.from_bytes(section7[position : position + extra_octets], "big"), extra_octets * 8)
        position += extra_octets

    bit = position * 8
    references = _read_bits(section7, bit, nbits, groups)
    bit += (nbits * groups + 7) // 8 * 8
    widths = _read_bits(section7, bit, width_bits, groups) + width_ref
    bit += (width_bits * groups + 7) // 8 * 8
    lengths = _read_bits(section7, bit, length_bits, groups) * length_inc + length_ref
    bit += (length_bits * groups + 7) // 8 * 8
    lengths[-1] = last_length
    if int(lengths.sum()) != count:
        raise Grib2Error("group lengths do not add up to the number of points")

    values = np.empty(count, dtype=np.int64)
    at = 0
    for reference, width, length in zip(references.tolist(), widths.tolist(), lengths.tolist()):
        values[at : at + length] = reference + _read_bits(section7, bit, width, length)
        bit += width * length
        at += length

    if template == 3:
        if order == 1:
            values[0] = initial[0]
            values[1:] += minimum
            values = np.cumsum(values)
        else:
            values[0], values[1] = initial
            values[2:] += minimum
            # Second differences: integrate twice, seeded with the first difference.
            first = np.empty(count, dtype=np.int64)
            first[0] = 0
            first[1] = values[1] - values[0]
            first[2:] = values[2:]
            first = np.cumsum(first)
            first[0] = values[0]
            values = np.cumsum(first)
    return values


def decode(message: bytes) -> Grib2Field:
    s = _sections(message)
    for needed in (1, 3, 4, 5, 6, 7):
        if needed not in s:
            raise Grib2Error(f"section {needed} is missing")

    year, month, day, hour, minute, second = struct.unpack(">HBBBBB", s[1][12:19])
    reference_time = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}Z"

    grid_template = struct.unpack(">H", s[3][12:14])[0]
    if grid_template != 0:
        raise Grib2Error(f"grid template 3.{grid_template} is not supported")
    ni, nj = struct.unpack(">II", s[3][30:38])
    lat_first, lon_first = (_signed(v, 32) / 1e6 for v in struct.unpack(">II", s[3][46:54]))
    lat_last, lon_last = (_signed(v, 32) / 1e6 for v in struct.unpack(">II", s[3][55:63]))
    scan = s[3][71]
    if scan & 0b10110000:
        raise Grib2Error(f"scanning mode {scan:#010b} is not supported")
    lon_step = ((lon_last - lon_first) % 360) / (ni - 1)
    lat_step = (lat_last - lat_first) / (nj - 1)

    product_template = struct.unpack(">H", s[4][7:9])[0]
    if product_template not in (0, 8):
        raise Grib2Error(f"product template 4.{product_template} is not supported")
    category, number = s[4][9], s[4][10]
    time_unit = s[4][17]
    forecast = struct.unpack(">I", s[4][18:22])[0]
    if time_unit != 1:
        raise Grib2Error("forecast time is not in hours")
    level_type = s[4][22]
    level_value = _signed(struct.unpack(">I", s[4][24:28])[0], 32) / 10 ** s[4][23]

    count = struct.unpack(">I", s[5][5:9])[0]
    template = struct.unpack(">H", s[5][9:11])[0]
    if count != ni * nj or s[6][5] != 255:
        raise Grib2Error("bitmapped fields are not supported")
    reference = struct.unpack(">f", s[5][11:15])[0]
    binary_scale = _signed(struct.unpack(">H", s[5][15:17])[0], 16)
    decimal_scale = _signed(struct.unpack(">H", s[5][17:19])[0], 16)
    if template == 0:
        packed = _read_bits(s[7], 5 * 8, s[5][19], count)
    elif template in (2, 3):
        packed = _unpack_complex(s[5], s[7], template, count)
    else:
        raise Grib2Error(f"data representation 5.{template} is not supported")
    values = (reference + packed.astype(np.float64) * 2.0**binary_scale) / 10.0**decimal_scale

    return Grib2Field(
        discipline=s[0][6],
        category=category,
        number=number,
        reference_time=reference_time,
        forecast_hours=forecast,
        level_type=level_type,
        level_value=level_value,
        ni=ni,
        nj=nj,
        lat_first=lat_first,
        lon_first=lon_first,
        lat_step=lat_step,
        lon_step=lon_step,
        values=values.reshape(nj, ni),
    )
