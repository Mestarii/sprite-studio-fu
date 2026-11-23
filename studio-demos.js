'use strict';

function mountSpriteDemos(notes) {
  const examples = {
    pixel_legacy: { id: 'javlight', name: 'Javlight' },
    topdown_pixel: { id: 'lory', name: 'Lory Kzoa' },
    topdown_hd: { id: 'cecille', name: 'Cecille Von Trotesch' },
  };
  const canvas = document.querySelector('#demo-stage');
  const ctx = canvas.getContext('2d');
  const still = document.querySelector('#demo-still');
  const title = document.querySelector('#demo-title');
  const status = document.querySelector('#demo-status');
  const profileNote = document.querySelector('#profile-note');
  const manifestLink = document.querySelector('#demo-manifest');
  const play = document.querySelector('#demo-play');
  const replay = document.querySelector('#demo-replay');
  const buttons = [...document.querySelectorAll('[data-demo]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();

  let selection;
  let pack;
  let scenes;
  let elapsed = 0;
  let lastTick;
  let animationId;
  let paused;

  function makeScenes(clips) {
    const moving = [
      { clip: 'idle', seconds: .45, from: .24, to: .24, fadeIn: true },
      { clip: 'run', seconds: 1.35, from: .24, to: .46 },
      { clip: clips.stop_e ? 'stop_e' : 'run', seconds: .42, from: .46, to: .5, slowdown: true },
      { clip: 'idle', seconds: .85 },
    ];
    return [
      { label: 'Avance, reposo y caída', steps: [
        ...moving, { clip: 'fall' }, { clip: 'down', seconds: 1.1 },
        { clip: 'rise' }, { clip: 'idle', seconds: .9, fadeOut: true },
      ] },
      { label: 'Avance y reposo', steps: [
        ...moving, { clip: 'idle', seconds: 1.3, fadeOut: true },
      ] },
      { label: 'Avance y reacción al daño', steps: [
        ...moving, { clip: 'hurt' }, { clip: 'idle', seconds: 1.25, fadeOut: true },
      ] },
    ].flatMap(scene => scene.steps.map(step => ({
      ...step, label: scene.label,
      seconds: step.seconds ?? clips[step.clip].frames.length / clips[step.clip].fps,
    })));
  }

  function render() {
    if (!pack) return;
    const { frame, clips, columns, pixelArt, image } = pack;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(bounds.width * dpr);
    const height = Math.round(bounds.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const duration = scenes.reduce((sum, step) => sum + step.seconds, 0);
    let time = elapsed % duration;
    const step = scenes.find(candidate => {
      if (time < candidate.seconds) return true;
      time -= candidate.seconds;
      return false;
    });
    const progress = time / step.seconds;
    const clip = clips[step.clip];
    const frameIndex = step.clip === 'stop_e'
      ? Math.floor(progress * clip.frames.length)
      : Math.floor(time * clip.fps);
    const pose = clip.frames[frameIndex % clip.frames.length];
    const distance = step.slowdown ? 1 - (1 - progress) ** 2 : progress;
    const position = step.from === undefined ? .5 : step.from + (step.to - step.from) * distance;
    const size = Math.min(height * (pixelArt ? .76 : 1.14) / frame.height, width * .44 / frame.width);
    const drawWidth = frame.width * size;
    const drawHeight = frame.height * size;
    const ground = height * .83;

    ctx.imageSmoothingEnabled = !pixelArt;
    const showStatic = paused && elapsed === 0;
    ctx.globalAlpha = showStatic ? 1 : step.fadeIn ? Math.min(1, time / .18) :
      step.fadeOut ? Math.min(1, (step.seconds - time) / .24) : 1;
    ctx.drawImage(image,
      pose % columns * frame.width, Math.floor(pose / columns) * frame.height, frame.width, frame.height,
      width * (showStatic ? .5 : position) - drawWidth / 2, ground - frame.baseline * size, drawWidth, drawHeight);
    ctx.globalAlpha = 1;
    if (status.textContent !== step.label) status.textContent = step.label;
  }

  function animate(timestamp) {
    if (paused || !pack) return;
    if (lastTick !== undefined) elapsed += Math.min((timestamp - lastTick) / 1000, .1);
    lastTick = timestamp;
    render();
    animationId = requestAnimationFrame(animate);
  }

  function setPaused(value) {
    cancelAnimationFrame(animationId);
    paused = value;
    lastTick = undefined;
    play.textContent = paused ? 'Reproducir' : 'Pausar';
    if (paused) render();
    else animationId = requestAnimationFrame(animate);
  }

  async function loadPack(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const image = new Image();
    image.src = new URL(manifest.atlas, url);
    await image.decode();
    if (image.naturalWidth !== manifest.frame.width * manifest.columns ||
        image.naturalHeight !== manifest.frame.height * manifest.rows) {
      throw new Error('Las dimensiones de la hoja no coinciden con el manifiesto.');
    }
    return { ...manifest, image };
  }

  async function select(profile) {
    cancelAnimationFrame(animationId);
    const { id, name } = examples[profile];
    const manifestUrl = new URL(`demos/${id}.json`, document.baseURI).href;
    const stillUrl = new URL(`${id}-reposo.webp`, manifestUrl).href;
    const current = { profile, stillUrl };
    selection = current;
    pack = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    title.textContent = name;
    profileNote.textContent = notes[profile];
    status.textContent = 'Cargando animación…';
    canvas.setAttribute('aria-label', `Animación de ${name} sobre una cuadrícula`);
    still.alt = `Sprite de ${name} en reposo`;
    still.src = stillUrl;
    still.classList.toggle('pixel', profile !== 'topdown_hd');
    manifestLink.href = manifestUrl;
    play.disabled = replay.disabled = true;
    buttons.forEach(button => button.setAttribute('aria-pressed', button.dataset.demo === profile));

    if (!cache.has(profile)) cache.set(profile, loadPack(manifestUrl));
    try {
      const loaded = await cache.get(profile);
      if (selection !== current) return;
      pack = loaded;
      scenes = makeScenes(pack.clips);
      elapsed = 0;
      play.disabled = replay.disabled = false;
      setPaused(reducedMotion.matches);
    } catch (error) {
      cache.delete(profile);
      if (selection === current) status.textContent = 'No se pudo cargar la animación. Vuelve a seleccionar el perfil.';
    }
  }

  new ResizeObserver(render).observe(canvas);
  buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.demo)));
  play.addEventListener('click', () => setPaused(!paused));
  replay.addEventListener('click', () => {
    elapsed = 0;
    setPaused(false);
  });
  select('topdown_hd');
  return { get selection() { return selection; } };
}

