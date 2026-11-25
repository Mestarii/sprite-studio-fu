'use strict';

const packManifestUrls = {
  topdown_hd: new URL('demos/cecille-hd-v080/manifest.json?v=hd-brazos-1', document.baseURI),
  topdown_pixel: new URL('demos/lory-pixel-v1/manifest.json', document.baseURI),
};
const packManifestRequests = new Map();

function loadProfileManifest(profile) {
  if (!packManifestRequests.has(profile)) packManifestRequests.set(profile, fetch(packManifestUrls[profile]).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).catch(error => {
    packManifestRequests.delete(profile);
    throw error;
  }));
  return packManifestRequests.get(profile);
}

function mountSpriteDemos() {
  const examples = {
    pixel_legacy: { id: 'javlight', name: 'Javlight' },
    topdown_pixel: { id: 'lory', name: 'Lory Kzoa' },
    topdown_hd: { id: 'cecille', name: 'Cecille Von Trotesch' },
  };
  const canvas = document.querySelector('#demo-stage');
  const ctx = canvas.getContext('2d');
  const idleCanvas = document.querySelector('#demo-idle');
  const idleContext = idleCanvas?.getContext('2d');
  // A cached GitHub Pages document can still have the previous static preview.
  const cachedStill = document.querySelector('#demo-still');
  const status = document.querySelector('#demo-status');
  const play = document.querySelector('#demo-play');
  const replay = document.querySelector('#demo-replay');
  const buttons = [...document.querySelectorAll('[data-demo]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();
  for (const selector of ['#demo-title','#profile-note','#demo-manifest']) {
    const obsolete = document.querySelector(selector);
    if (obsolete) obsolete.hidden = true;
  }

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

  function makeHDScenes(clips) {
    return [
      { clip: 'idle', seconds: .55, from: .24, to: .24, fadeIn: true },
      { clip: 'run_e', seconds: 1.2, from: .24, to: .5, slowdown: true },
      { clip: 'idle', seconds: .65 },
      { clip: 'hurt_guard' }, { clip: 'fall' }, { clip: 'down', seconds: 1.2 }, { clip: 'rise' },
      { clip: 'posture_dodge', seconds: 1.9 }, { clip: 'posture_dodge_back' },
      { clip: 'posture_dodge', seconds: 1.25 },
      { clip: 'posture_hide_ne', seconds: 1.2 },
      { clip: 'posture_sneak_ne', seconds: 1.1, from: .5, to: .64, lift: .07 },
      { clip: 'posture_sneak_n', seconds: .8, from: .64, to: .64, lift: .07, elevation: .07 },
      { clip: 'posture_hide_n', seconds: 1.2, from: .64, to: .64, elevation: .14, fadeOut: true },
      { clip: 'posture_rage', seconds: 1.8, fadeIn: true },
      { clip: 'dnd_weapon_heavy' }, { clip: 'dnd_cast_cone' }, { clip: 'dnd_summon_arcane' },
      { clip: 'condition_poisoned', seconds: 1.8 },
      { clip: 'condition_prone_trip' }, { clip: 'condition_prone', seconds: 1.2 },
      { clip: 'rise' }, { clip: 'idle', seconds: .9, fadeOut: true },
    ].map(step => ({
      ...step,
      seconds: step.seconds ?? clips[step.clip].frames.length / clips[step.clip].fps,
    }));
  }

  function makeLoryScenes(clips) {
    return [
      { clip: 'idle', seconds: .7, from: .24, to: .24, fadeIn: true },
      { clip: 'run', seconds: 1.2, from: .24, to: .45 },
      { clip: 'stop_e', seconds: .6, from: .45, to: .5, slowdown: true },
      { clip: 'posture_dodge', seconds: 2 },
      { clip: 'posture_dodge_back' },
      { clip: 'posture_dodge', seconds: .9 },
      { clip: 'posture_hide_ne', seconds: .9 },
      { clip: 'posture_sneak_ne', seconds: 1.15, from: .5, to: .64, lift: .06 },
      { clip: 'posture_sneak_n', seconds: .85, from: .64, to: .64, lift: .04, elevation: .06 },
      { clip: 'posture_hide_n', seconds: 1, from: .64, to: .64, elevation: .10, fadeOut: true },
      { clip: 'posture_rage', seconds: 1.35, fadeIn: true },
      { clip: 'dnd_weapon_heavy' },
      { clip: 'dnd_cast_cone' },
      { clip: 'dnd_summon_nature' },
      { clip: 'hurt_guard' },
      { clip: 'idle_exhausted', seconds: .8 },
      { clip: 'idle_exhausted_sigh' },
      { clip: 'condition_prone_trip' },
      { clip: 'condition_prone', seconds: 1.25 },
      { clip: 'rise' },
      { clip: 'idle', seconds: .9, fadeOut: true },
    ].map(step => ({
      ...step,
      seconds: step.seconds ?? clips[step.clip].frames.length / clips[step.clip].fps,
    }));
  }

  function drawPose(surface, context, pose, position, alpha, fitWidth, clip, elevation = 0) {
    const { frame, pixelArt } = pack;
    const image = clip?.image ?? pack.image;
    const columns = clip?.columns ?? pack.columns;
    if (!image) return;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(bounds.width * dpr);
    const height = Math.round(bounds.height * dpr);
    if (surface.width !== width) surface.width = width;
    if (surface.height !== height) surface.height = height;
    context.clearRect(0, 0, width, height);
    const verticalFit = pixelArt && !pack.sheetClips ? .76 : fitWidth === .44 ? .70 : .79;
    const size = Math.min(height * verticalFit / frame.height, width * fitWidth / frame.width);
    const drawWidth = frame.width * size;
    const drawHeight = frame.height * size;
    context.imageSmoothingEnabled = !pixelArt;
    context.globalAlpha = alpha;
    context.drawImage(image,
      pose % columns * frame.width, Math.floor(pose / columns) * frame.height, frame.width, frame.height,
      width * position - drawWidth / 2, height * (.83 - elevation) - frame.baseline * size, drawWidth, drawHeight);
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
    const clip = clips[step.clip].failed ? clips.idle : clips[step.clip];
    if (pack.sheetClips) {
      const next = scenes[(scenes.indexOf(step) + 1) % scenes.length];
      requestClip(clips[next.clip]);
      if (!clip.failed && !clip.image) {
        requestClip(clip);
        return false;
      }
    }
    const frameIndex = step.clip === 'stop_e'
      ? Math.floor(progress * clip.frames.length)
      : Math.floor(time * clip.fps);
    const pose = clip.frames[frameIndex % clip.frames.length];
    const distance = step.slowdown ? 1 - (1 - progress) ** 2 : progress;
    const position = step.from === undefined ? .5 : step.from + (step.to - step.from) * distance;
    const showStatic = paused && elapsed === 0;
    const alpha = showStatic ? 1 : step.fadeIn ? Math.min(1, time / .18) :
      step.fadeOut ? Math.min(1, (step.seconds - time) / .24) : 1;
    const elevation = (step.elevation ?? 0) + (step.lift ?? 0) * distance;
    drawPose(canvas, ctx, pose, showStatic ? .5 : position, alpha, .44, clip, elevation);

    if (idleContext && pack.sheetClips) {
      const { gestures } = pack;
      let gestureTime = elapsed % gestures.reduce((sum, gesture) => sum + gesture.wait + gesture.duration, 0);
      const gesture = gestures.find(candidate => {
        if (gestureTime < candidate.wait + candidate.duration) return true;
        gestureTime -= candidate.wait + candidate.duration;
        return false;
      });
      if (gesture) requestClip(gesture.clip);
      const showGesture = gesture?.clip.image && gestureTime >= gesture.wait;
      const restingClip = showGesture ? gesture.clip : clips.idle;
      const restingTime = showGesture ? gestureTime - gesture.wait : elapsed;
      const restingPose = restingClip.frames[Math.floor(restingTime * restingClip.fps) % restingClip.frames.length];
      drawPose(idleCanvas, idleContext, restingPose, .5, 1, .92, restingClip);
    } else if (idleContext) {
      const gesture = clips.idle_scratch;
      const wait = 6;
      const idleTime = gesture ? elapsed % (wait + gesture.frames.length / gesture.fps) : elapsed;
      const restingClip = gesture && idleTime >= wait ? gesture : clips.idle;
      const restingTime = restingClip === gesture ? idleTime - wait : idleTime;
      const restingPose = restingClip.frames[Math.floor(restingTime * restingClip.fps) % restingClip.frames.length];
      drawPose(idleCanvas, idleContext, restingPose, .5, 1, .92);
    }
  }

  function animate(timestamp) {
    if (paused || !pack) return;
    const nextElapsed = elapsed + (lastTick === undefined ? 0 : Math.min((timestamp - lastTick) / 1000, .1));
    lastTick = timestamp;
    const previousElapsed = elapsed;
    elapsed = nextElapsed;
    if (render() === false) elapsed = previousElapsed;
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

  function requestClip(clip) {
    return clip.promise ??= new Promise((resolve, reject) => {
      const sheet = new Image();
      sheet.onload = () => {
        if (sheet.naturalWidth !== clip.width || sheet.naturalHeight !== clip.height) {
          reject(new Error(`Las dimensiones de ${clip.url} no coinciden con el manifiesto.`));
          return;
        }
        clip.image = sheet;
        resolve();
      };
      sheet.onerror = () => reject(new Error(`No se pudo cargar ${clip.url}.`));
      sheet.src = clip.url;
    }).catch(error => {
      clip.failed = true;
      return error;
    });
  }

  async function loadAnimationPack(profile) {
    const manifest = await loadProfileManifest(profile);
    const manifestUrl = packManifestUrls[profile];
    const { frame } = manifest;
    const clips = Object.fromEntries(Object.entries(manifest.animations).map(([name, animation]) => {
      const { frames, columns = frames } = animation;
      const url = new URL(animation.sheet, manifestUrl);
      url.search = manifestUrl.search;
      return [name, {
        ...animation,
        columns,
        frames: Array.from({ length: frames }, (_, index) => index),
        url: url.href,
        width: frame.width * columns,
        height: frame.height * Math.ceil(frames / columns),
      }];
    }));
    const failure = await requestClip(clips.idle);
    if (failure) throw failure;
    const [minDelay, maxDelay] = manifest.idleGestures.delaySeconds;
    const gestures = manifest.idleGestures.variants.map((name, index, variants) => {
      const clip = clips[name];
      return {
        clip,
        wait: minDelay + (maxDelay - minDelay) * index / Math.max(1, variants.length - 1),
        duration: clip.frames.length / clip.fps,
      };
    });
    return { frame, clips, gestures, sheetClips: true, pixelArt: manifest.textureSampling !== 'linear' };
  }

  async function loadPack(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const image = await new Promise((resolve, reject) => {
      const atlas = new Image();
      atlas.onload = () => resolve(atlas);
      atlas.onerror = () => reject(new Error('La hoja de sprites no está disponible.'));
      atlas.src = new URL(manifest.atlas, url);
    });
    if (image.naturalWidth !== manifest.frame.width * manifest.columns ||
        image.naturalHeight !== manifest.frame.height * manifest.rows) {
      throw new Error('Las dimensiones de la hoja no coinciden con el manifiesto.');
    }
    return { ...manifest, image };
  }

  async function select(profile) {
    cancelAnimationFrame(animationId);
    const { id, name } = examples[profile];
    const curated = packManifestUrls[profile];
    const manifestUrl = curated ?? new URL(`demos/${id}.json`, document.baseURI);
    const stillUrl = new URL(curated ? 'native-idle.webp' : `${id}-reposo.webp`, manifestUrl).href;
    const current = { profile, stillUrl };
    selection = current;
    pack = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (idleContext) {
      idleContext.clearRect(0, 0, idleCanvas.width, idleCanvas.height);
      idleCanvas.setAttribute('aria-label', `Animación de ${name} en reposo`);
      idleCanvas.style.backgroundImage = `url("${stillUrl}")`;
    }
    if (cachedStill) {
      cachedStill.alt = `Sprite de ${name} en reposo`;
      cachedStill.src = stillUrl;
      cachedStill.classList.toggle('pixel', profile !== 'topdown_hd');
    }
    status.hidden = false;
    status.textContent = 'Cargando animación…';
    canvas.setAttribute('aria-label', `Animación de ${name} sobre una cuadrícula`);
    play.disabled = replay.disabled = true;
    buttons.forEach(button => button.setAttribute('aria-pressed', button.dataset.demo === profile));

    if (!cache.has(profile)) cache.set(profile, curated ? loadAnimationPack(profile) : loadPack(manifestUrl));
    try {
      const loaded = await cache.get(profile);
      if (selection !== current) return;
      pack = loaded;
      const makeProfileScenes = profile === 'topdown_hd' ? makeHDScenes
        : profile === 'topdown_pixel' ? makeLoryScenes : makeScenes;
      scenes = makeProfileScenes(pack.clips);
      sceneDuration = scenes.reduce((sum, step) => sum + step.seconds, 0);
      elapsed = 0;
      status.hidden = true;
      if (idleCanvas) idleCanvas.style.backgroundImage = 'none';
      play.disabled = replay.disabled = false;
      setPaused(reducedMotion.matches);
    } catch (error) {
      cache.delete(profile);
      if (selection === current) status.textContent = 'No se pudo cargar la animación. Vuelve a seleccionar el perfil.';
    }
  }

  const resize = new ResizeObserver(render);
  resize.observe(canvas);
  if (idleCanvas) resize.observe(idleCanvas);
  buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.demo)));
  play.addEventListener('click', () => setPaused(!paused));
  replay.addEventListener('click', () => {
    elapsed = 0;
    setPaused(false);
  });
  select('topdown_hd');
  return { get selection() { return selection; } };
}

