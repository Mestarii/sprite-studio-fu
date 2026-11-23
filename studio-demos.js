'use strict';

function mountSpriteDemos() {
  const examples = {
    pixel_legacy: { id: 'javlight', name: 'Javlight' },
    topdown_pixel: { id: 'lory', name: 'Lory Kzoa' },
    topdown_hd: { id: 'cecille', name: 'Cecille Von Trotesch', manifest: 'cecille-hd-revisado' },
  };
  const canvas = document.querySelector('#demo-stage');
  const ctx = canvas.getContext('2d');
  const idleCanvas = document.querySelector('#demo-idle');
  const idleContext = idleCanvas.getContext('2d');
  const status = document.querySelector('#demo-status');
  const play = document.querySelector('#demo-play');
  const replay = document.querySelector('#demo-replay');
  const buttons = [...document.querySelectorAll('[data-demo]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();

  let selection;
  let pack;
  let scenes;
  let sceneDuration;
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
    const rest = clips.idle_scratch ? [{ clip: 'idle_scratch' }] : [];
    return [
      [
        ...moving, { clip: 'fall' }, { clip: 'down', seconds: 1.1 },
        { clip: 'rise' }, { clip: 'idle', seconds: .9, fadeOut: true },
      ],
      [
        ...moving, ...rest, { clip: 'idle', seconds: 1.3, fadeOut: true },
      ],
      [
        ...moving, { clip: 'hurt' }, { clip: 'idle', seconds: 1.25, fadeOut: true },
      ],
    ].flat().map(step => ({
      ...step,
      seconds: step.seconds ?? clips[step.clip].frames.length / clips[step.clip].fps,
    }));
  }

  function drawPose(surface, context, pose, position, alpha, fitWidth) {
    const { frame, columns, pixelArt, image } = pack;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(bounds.width * dpr);
    const height = Math.round(bounds.height * dpr);
    if (surface.width !== width) surface.width = width;
    if (surface.height !== height) surface.height = height;
    context.clearRect(0, 0, width, height);
    const size = Math.min(height * (pixelArt ? .76 : 1.14) / frame.height, width * fitWidth / frame.width);
    const drawWidth = frame.width * size;
    const drawHeight = frame.height * size;
    context.imageSmoothingEnabled = !pixelArt;
    context.globalAlpha = alpha;
    context.drawImage(image,
      pose % columns * frame.width, Math.floor(pose / columns) * frame.height, frame.width, frame.height,
      width * position - drawWidth / 2, height * .83 - frame.baseline * size, drawWidth, drawHeight);
    context.globalAlpha = 1;
  }

  function render() {
    if (!pack) return;
    const { clips } = pack;
    let time = elapsed % sceneDuration;
    const step = scenes.find(candidate => {
      if (time < candidate.seconds) return true;
      time -= candidate.seconds;
      return false;
    }) ?? scenes[0];
    const progress = time / step.seconds;
    const clip = clips[step.clip];
    const frameIndex = step.clip === 'stop_e'
      ? Math.floor(progress * clip.frames.length)
      : Math.floor(time * clip.fps);
    const pose = clip.frames[frameIndex % clip.frames.length];
    const distance = step.slowdown ? 1 - (1 - progress) ** 2 : progress;
    const position = step.from === undefined ? .5 : step.from + (step.to - step.from) * distance;
    const showStatic = paused && elapsed === 0;
    const alpha = showStatic ? 1 : step.fadeIn ? Math.min(1, time / .18) :
      step.fadeOut ? Math.min(1, (step.seconds - time) / .24) : 1;
    drawPose(canvas, ctx, pose, showStatic ? .5 : position, alpha, .44);

    const gesture = clips.idle_scratch;
    const wait = 6;
    const idleTime = gesture ? elapsed % (wait + gesture.frames.length / gesture.fps) : elapsed;
    const restingClip = gesture && idleTime >= wait ? gesture : clips.idle;
    const restingTime = restingClip === gesture ? idleTime - wait : idleTime;
    const restingPose = restingClip.frames[Math.floor(restingTime * restingClip.fps) % restingClip.frames.length];
    drawPose(idleCanvas, idleContext, restingPose, .5, 1, .92);
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
    const { id, name, manifest = id } = examples[profile];
    const manifestUrl = new URL(`demos/${manifest}.json`, document.baseURI).href;
    const stillUrl = new URL(`${id}-reposo.webp`, manifestUrl).href;
    const current = { profile, stillUrl };
    selection = current;
    pack = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    idleContext.clearRect(0, 0, idleCanvas.width, idleCanvas.height);
    status.hidden = false;
    status.textContent = 'Cargando animación…';
    canvas.setAttribute('aria-label', `Animación de ${name} sobre una cuadrícula`);
    idleCanvas.setAttribute('aria-label', `Animación de ${name} en reposo`);
    play.disabled = replay.disabled = true;
    buttons.forEach(button => button.setAttribute('aria-pressed', button.dataset.demo === profile));

    if (!cache.has(profile)) cache.set(profile, loadPack(manifestUrl));
    try {
      const loaded = await cache.get(profile);
      if (selection !== current) return;
      pack = loaded;
      scenes = makeScenes(pack.clips);
      sceneDuration = scenes.reduce((sum, step) => sum + step.seconds, 0);
      elapsed = 0;
      status.hidden = true;
      play.disabled = replay.disabled = false;
      setPaused(reducedMotion.matches);
    } catch (error) {
      cache.delete(profile);
      if (selection === current) status.textContent = 'No se pudo cargar la animación. Vuelve a seleccionar el perfil.';
    }
  }

  const resize = new ResizeObserver(render);
  resize.observe(canvas);
  resize.observe(idleCanvas);
  buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.demo)));
  play.addEventListener('click', () => setPaused(!paused));
  replay.addEventListener('click', () => {
    elapsed = 0;
    setPaused(false);
  });
  select('topdown_hd');
  return { get selection() { return selection; } };
}

