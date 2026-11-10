/**
 * Recorded USGS responses, for the catalogue client's tests. Features are
 * verbatim; only the feed's feature list is cut down (metadata.count
 * adjusted to match).
 *
 * FDSN_QUERY_TOHOKU: https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2011-03-11T05%3A00%3A00&endtime=2011-03-11T07%3A00%3A00&minmagnitude=7&orderby=time-asc
 * FEED_EXCERPT: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson — the two largest earthquakes,
 * one event above sea level (negative depth) and one quarry blast.
 * Both fetched 2026-11-10 UTC. USGS data are public domain.
 */

export const FDSN_QUERY_TOHOKU: unknown = {
  "type": "FeatureCollection",
  "metadata": {
    "generated": 1794270502000,
    "url": "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2011-03-11T05%3A00%3A00&endtime=2011-03-11T07%3A00%3A00&minmagnitude=7&orderby=time-asc",
    "title": "USGS Earthquakes",
    "status": 200,
    "api": "2.8.4",
    "count": 3
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "mag": 9.1,
        "place": "2011 Great Tohoku Earthquake, Japan",
        "time": 1299822384120,
        "updated": 1792147089160,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/official20110311054624120_30",
        "detail": "https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=official20110311054624120_30&format=geojson",
        "felt": 1460,
        "cdi": 9.1,
        "mmi": 8.18,
        "alert": null,
        "status": "reviewed",
        "tsunami": 0,
        "sig": 2184,
        "net": "official",
        "code": "20110311054624120_30",
        "ids": ",usc0001xgp,official20110311054624120_30,usp000hvnu,choy20110311054623,duputel201103110546a,atlas20110311054624,iscgem16461282,",
        "sources": ",us,official,us,choy,duputel,atlas,iscgem,",
        "types": ",dyfi,finite-fault,focal-mechanism,general-header,general-link,general-text,ground-failure,impact-text,moment-tensor,origin,phase-data,poster,scitech-link,scitech-text,shakemap,trump-impact-text,trump-origin,trump-phase-data,trump-shakemap,",
        "nst": 541,
        "dmin": null,
        "rms": 1.16,
        "gap": 9.5,
        "magType": "mww",
        "type": "earthquake",
        "title": "M 9.1 - 2011 Great Tohoku Earthquake, Japan"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          142.373,
          38.297,
          29
        ]
      },
      "id": "official20110311054624120_30"
    },
    {
      "type": "Feature",
      "properties": {
        "mag": 7.9,
        "place": "47 km E of ?arai, Japan",
        "time": 1299824140280,
        "updated": 1686766058583,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/usp000hvpa",
        "detail": "https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=usp000hvpa&format=geojson",
        "felt": 256,
        "cdi": 7.6,
        "mmi": 6.705,
        "alert": null,
        "status": "reviewed",
        "tsunami": 0,
        "sig": 1155,
        "net": "us",
        "code": "p000hvpa",
        "ids": ",usc0001xhz,usp000hvpa,atlas20110311061540,iscgem602707261,",
        "sources": ",us,us,atlas,iscgem,",
        "types": ",associate,dyfi,general-text,impact-text,moment-tensor,origin,phase-data,poster,shakemap,trump-shakemap,",
        "nst": 163,
        "dmin": null,
        "rms": 1.44,
        "gap": 48.4,
        "magType": "mwc",
        "type": "earthquake",
        "title": "M 7.9 - 47 km E of ?arai, Japan"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          141.111,
          36.281,
          42.6
        ]
      },
      "id": "usp000hvpa"
    },
    {
      "type": "Feature",
      "properties": {
        "mag": 7.7,
        "place": "272 km ESE of Kamaishi, Japan",
        "time": 1299824750300,
        "updated": 1658217891126,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/usp000hvpg",
        "detail": "https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=usp000hvpg&format=geojson",
        "felt": 28,
        "cdi": 6.8,
        "mmi": 4.081,
        "alert": null,
        "status": "reviewed",
        "tsunami": 0,
        "sig": 931,
        "net": "us",
        "code": "p000hvpg",
        "ids": ",usc0001xig,usp000hvpg,iscgem16304073,",
        "sources": ",us,us,iscgem,",
        "types": ",associate,dyfi,general-text,impact-text,moment-tensor,origin,phase-data,poster,shakemap,",
        "nst": 507,
        "dmin": null,
        "rms": 0.85,
        "gap": 10.8,
        "magType": "mwc",
        "type": "earthquake",
        "title": "M 7.7 - 272 km ESE of Kamaishi, Japan"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          144.59,
          38.058,
          18.6
        ]
      },
      "id": "usp000hvpg"
    }
  ],
  "bbox": [
    141.111,
    36.281,
    18.6,
    144.59,
    38.297,
    42.6
  ]
};

export const FEED_EXCERPT: unknown = {
  "type": "FeatureCollection",
  "metadata": {
    "generated": 1794270550000,
    "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
    "title": "USGS Magnitude 2.5+ Earthquakes, Past Week",
    "status": 200,
    "api": "2.8.2",
    "count": 4
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "mag": 6.4,
        "place": "30 km WSW of Lata, Solomon Islands",
        "time": 1794195299466,
        "updated": 1794252069146,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tx16",
        "detail": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us7000tx16.geojson",
        "felt": 2,
        "cdi": 5.8,
        "mmi": 6.361,
        "alert": "green",
        "status": "reviewed",
        "tsunami": 0,
        "sig": 631,
        "net": "us",
        "code": "7000tx16",
        "ids": ",us7000tx16,",
        "sources": ",us,",
        "types": ",dyfi,ground-failure,losspager,moment-tensor,origin,phase-data,shakemap,",
        "nst": 129,
        "dmin": 5.706,
        "rms": 0.87,
        "gap": 29,
        "magType": "mww",
        "type": "earthquake",
        "title": "M 6.4 - 30 km WSW of Lata, Solomon Islands"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          165.5616,
          -10.8669,
          17
        ]
      },
      "id": "us7000tx16"
    },
    {
      "type": "Feature",
      "properties": {
        "mag": 6.1,
        "place": "144 km SE of Hasaki, Japan",
        "time": 1793961567869,
        "updated": 1794186849255,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000twg9",
        "detail": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us7000twg9.geojson",
        "felt": 39,
        "cdi": 4.2,
        "mmi": 0,
        "alert": "green",
        "status": "reviewed",
        "tsunami": 0,
        "sig": 589,
        "net": "us",
        "code": "7000twg9",
        "ids": ",us7000twg9,",
        "sources": ",us,",
        "types": ",dyfi,losspager,moment-tensor,origin,phase-data,shakemap,",
        "nst": 134,
        "dmin": 3.545,
        "rms": 0.76,
        "gap": 32,
        "magType": "mww",
        "type": "earthquake",
        "title": "M 6.1 - 144 km SE of Hasaki, Japan"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          142.1175,
          34.9677,
          29
        ]
      },
      "id": "us7000twg9"
    },
    {
      "type": "Feature",
      "properties": {
        "mag": 3.13,
        "place": "3 km NW of Little America, Wyoming",
        "time": 1794011863880,
        "updated": 1794236250990,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/uu80163296",
        "detail": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uu80163296.geojson",
        "felt": null,
        "cdi": null,
        "mmi": null,
        "alert": null,
        "status": "reviewed",
        "tsunami": 0,
        "sig": 151,
        "net": "uu",
        "code": "80163296",
        "ids": ",uu80163296,",
        "sources": ",uu,",
        "types": ",origin,phase-data,",
        "nst": 23,
        "dmin": 0.1155,
        "rms": 0.17,
        "gap": 112,
        "magType": "ml",
        "type": "earthquake",
        "title": "M 3.1 - 3 km NW of Little America, Wyoming"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          -109.886166666667,
          41.5646666666667,
          -1.97
        ]
      },
      "id": "uu80163296"
    },
    {
      "type": "Feature",
      "properties": {
        "mag": 2.7,
        "place": "15 km ENE of Ferry, Alaska",
        "time": 1793754812827,
        "updated": 1793984893904,
        "tz": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/aka2026vvdefx",
        "detail": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/aka2026vvdefx.geojson",
        "felt": null,
        "cdi": null,
        "mmi": null,
        "alert": null,
        "status": "reviewed",
        "tsunami": 0,
        "sig": 112,
        "net": "ak",
        "code": "a2026vvdefx",
        "ids": ",us7000tvv1,aka2026vvdefx,",
        "sources": ",us,ak,",
        "types": ",origin,phase-data,",
        "nst": 99,
        "dmin": 0.3,
        "rms": 1.3,
        "gap": 18,
        "magType": "ml",
        "type": "quarry blast",
        "title": "M 2.7 Quarry Blast - 15 km ENE of Ferry, Alaska"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          -148.816,
          64.056,
          0
        ]
      },
      "id": "aka2026vvdefx"
    }
  ]
};
