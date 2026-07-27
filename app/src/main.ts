import * as THREE from 'three';

function init(): void {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Resize handler
  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // Empty scene — just a dark background for now
  // Future: transparent Earth, seismic layers, weather overlays

  // const clock = new THREE.Clock(); // reserved for future delta-time animation

  function animate(): void {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

init();
