(function () {
  const reduceMotion = document.documentElement.classList.contains("reduce");
  const posterBase = document.getElementById("posterBase");
  const overlayCanvas = document.getElementById("overlayCanvas");
  const posterFrame = document.getElementById("posterFrame");
  const photoSlot = document.getElementById("photoSlot");
  const userPhoto = document.getElementById("userPhoto");
  const glowCrown = document.getElementById("glowCrown");
  const glowBanner = document.getElementById("glowBanner");
  const fileInput = document.getElementById("file");
  const uploadLabel = document.getElementById("uploadLabel");
  const fileNote = document.getElementById("fileNote");
  const zoom = document.getElementById("zoom");
  const rotate = document.getElementById("rotate");
  const zoomVal = document.getElementById("zoomVal");
  const rotVal = document.getElementById("rotVal");
  const zoomControl = document.getElementById("zoomControl");
  const rotControl = document.getElementById("rotControl");
  const statusEl = document.getElementById("status");
  const downloadBtn = document.getElementById("download");
  const resetBtn = document.getElementById("reset");
  const intro = document.getElementById("intro");
  const sparkCanvas = document.getElementById("sparks");

  const state = {
    photoReady: false,
    objectUrl: "",
    panX: 0,
    panY: 0,
    scale: 1,
    rot: 0,
    exporting: false
  };

  let frame = null;
  let prepared = false;
  const pointers = new Map();
  let dragOrigin = null;
  let pinchOrigin = null;
  let adjustTimer = 0;

  const sctx = sparkCanvas.getContext("2d");
  let sparks = [];
  let bursts = [];
  let sparkLoop = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function shake(el) {
    el.classList.remove("is-shake");
    void el.offsetWidth;
    el.classList.add("is-shake");
  }

  function syncSlider(el) {
    const min = Number(el.min);
    const max = Number(el.max);
    const val = Number(el.value);
    const p = max === min ? 0 : ((val - min) / (max - min)) * 100;
    el.style.setProperty("--p", p + "%");
  }

  function coverSize(iw, ih, sw, sh) {
    if (!iw || !ih || !sw || !sh) return { w: sw, h: sh };
    const imageRatio = iw / ih;
    const slotRatio = sw / sh;
    if (imageRatio > slotRatio) return { w: sh * imageRatio, h: sh };
    return { w: sw, h: sw / imageRatio };
  }

  function roundRect(ctx, x, y, w, h, rTop, rBottom) {
    const rt = Math.min(rTop, w / 2, h / 2);
    const rb = Math.min(rBottom, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rt, y);
    ctx.lineTo(x + w - rt, y);
    ctx.arcTo(x + w, y, x + w, y + rt, rt);
    ctx.lineTo(x + w, y + h - rb);
    ctx.arcTo(x + w, y + h, x + w - rb, y + h, rb);
    ctx.lineTo(x + rb, y + h);
    ctx.arcTo(x, y + h, x, y + h - rb, rb);
    ctx.lineTo(x, y + rt);
    ctx.arcTo(x, y, x + rt, y, rt);
    ctx.closePath();
  }

  function insideRound(px, py, x, y, w, h, rTop, rBottom) {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const cx = px - x;
    const cy = py - y;
    let radius = 0;
    let ox = 0;
    let oy = 0;
    if (cx < rTop && cy < rTop) {
      radius = rTop; ox = rTop; oy = rTop;
    } else if (cx > w - rTop && cy < rTop) {
      radius = rTop; ox = w - rTop; oy = rTop;
    } else if (cx > w - rBottom && cy > h - rBottom) {
      radius = rBottom; ox = w - rBottom; oy = h - rBottom;
    } else if (cx < rBottom && cy > h - rBottom) {
      radius = rBottom; ox = rBottom; oy = h - rBottom;
    } else {
      return true;
    }
    const dx = cx - ox;
    const dy = cy - oy;
    return dx * dx + dy * dy <= radius * radius;
  }

  function calibratedFrame(width, height) {
    const scale = width / 1024;
    return {
      x: 228 * scale,
      y: 378 * scale,
      w: 304 * scale,
      h: 456 * scale,
      rTop: 72 * scale,
      rBottom: 6 * scale
    };
  }

  function punchHole(imageData, width, height, area) {
    const data = imageData.data;
    const pad = 2;
    const x0 = Math.max(0, Math.floor(area.x) - pad);
    const y0 = Math.max(0, Math.floor(area.y) - pad);
    const x1 = Math.min(width - 1, Math.ceil(area.x + area.w) + pad);
    const y1 = Math.min(height - 1, Math.ceil(area.y + area.h) + pad);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!insideRound(x + 0.5, y + 0.5, area.x, area.y, area.w, area.h, area.rTop, area.rBottom)) continue;
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 34 && min > 220) data[i + 3] = 0;
      }
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min > 26 || min < 236) continue;
        const left = x > 0 && data[(y * width + (x - 1)) * 4 + 3] === 0;
        const right = x < width - 1 && data[(y * width + (x + 1)) * 4 + 3] === 0;
        const up = y > 0 && data[((y - 1) * width + x) * 4 + 3] === 0;
        const down = y < height - 1 && data[((y + 1) * width + x) * 4 + 3] === 0;
        if (left || right || up || down) data[i + 3] = 0;
      }
    }
  }

  function placeGlows() {
    const nw = posterBase.naturalWidth;
    const nh = posterBase.naturalHeight;
    glowCrown.style.left = ((frame.x / nw) * 100 - 1.5) + "%";
    glowCrown.style.top = ((frame.y / nh) * 100 - 2.5) + "%";
    glowCrown.style.width = (frame.w / nw) * 42 + "%";
    glowCrown.style.height = glowCrown.style.width;
    glowBanner.style.left = ((frame.x + frame.w / 2) / nw) * 100 + "%";
    glowBanner.style.top = ((frame.y + frame.h) / nh) * 100 + "%";
    glowBanner.style.width = (frame.w / nw) * 145 + "%";
    glowBanner.style.height = (frame.w / nw) * 48 + "%";
  }

  function layoutSlot() {
    if (!frame || !posterBase.naturalWidth) return;
    const scale = posterBase.clientWidth / posterBase.naturalWidth;
    photoSlot.style.left = frame.x * scale + "px";
    photoSlot.style.top = frame.y * scale + "px";
    photoSlot.style.width = frame.w * scale + "px";
    photoSlot.style.height = frame.h * scale + "px";
    const topRadius = frame.rTop * scale;
    const bottomRadius = frame.rBottom * scale;
    photoSlot.style.borderRadius = topRadius + "px " + topRadius + "px " + bottomRadius + "px " + bottomRadius + "px";
    if (state.photoReady) applyTransform();
  }

  function preparePoster() {
    if (prepared || !posterBase.naturalWidth) return;
    prepared = true;
    const width = posterBase.naturalWidth;
    const height = posterBase.naturalHeight;
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const ctx = overlayCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(posterBase, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    frame = calibratedFrame(width, height);
    punchHole(imageData, width, height, frame);
    ctx.putImageData(imageData, 0, 0);
    placeGlows();
    layoutSlot();
  }

  function clampPan() {
    const rect = photoSlot.getBoundingClientRect();
    if (!rect.width || !userPhoto.naturalWidth) return;
    const base = coverSize(userPhoto.naturalWidth, userPhoto.naturalHeight, rect.width, rect.height);
    const drawnW = base.w * state.scale;
    const drawnH = base.h * state.scale;
    const slack = 0.28 * Math.abs(Math.sin((state.rot * Math.PI) / 180));
    const maxX = Math.max(0, (drawnW - rect.width) / 2) / rect.width + slack;
    const maxY = Math.max(0, (drawnH - rect.height) / 2) / rect.height + slack;
    state.panX = clamp(state.panX, -maxX, maxX);
    state.panY = clamp(state.panY, -maxY, maxY);
  }

  function applyTransform() {
    const rect = photoSlot.getBoundingClientRect();
    if (!rect.width || !userPhoto.naturalWidth) return;
    clampPan();
    const base = coverSize(userPhoto.naturalWidth, userPhoto.naturalHeight, rect.width, rect.height);
    userPhoto.style.width = base.w + "px";
    userPhoto.style.height = base.h + "px";
    const dx = state.panX * rect.width;
    const dy = state.panY * rect.height;
    userPhoto.style.transform =
      "translate(-50%, -50%) translate(" + dx + "px, " + dy + "px) rotate(" + state.rot + "deg) scale(" + state.scale + ")";
  }

  function markAdjusting() {
    photoSlot.classList.add("is-adjusting");
    clearTimeout(adjustTimer);
    adjustTimer = setTimeout(function () {
      photoSlot.classList.remove("is-adjusting");
    }, 180);
  }

  function setScale(value, fromSlider) {
    state.scale = clamp(value, 1, 3);
    zoom.value = String(state.scale);
    syncSlider(zoom);
    zoomVal.textContent = Math.round(state.scale * 100) + "%";
    if (!fromSlider) markAdjusting();
    applyTransform();
  }

  function setRot(value, fromSlider) {
    let next = value;
    while (next > 180) next -= 360;
    while (next < -180) next += 360;
    state.rot = next;
    rotate.value = String(Math.round(next));
    syncSlider(rotate);
    rotVal.textContent = Math.round(next) + "°";
    if (!fromSlider) markAdjusting();
    applyTransform();
  }

  function setControlsEnabled(enabled) {
    zoom.disabled = !enabled;
    rotate.disabled = !enabled;
    resetBtn.disabled = !enabled;
    document.getElementById("zoomIn").disabled = !enabled;
    document.getElementById("zoomOut").disabled = !enabled;
    document.getElementById("rotLeft").disabled = !enabled;
    document.getElementById("rotRight").disabled = !enabled;
    zoomControl.classList.toggle("is-off", !enabled);
    rotControl.classList.toggle("is-off", !enabled);
    photoSlot.classList.toggle("has-photo", enabled);
  }

  function onPhotoReady() {
    state.photoReady = true;
    state.panX = 0;
    state.panY = 0;
    state.scale = 1;
    state.rot = 0;
    zoom.value = "1";
    rotate.value = "0";
    syncSlider(zoom);
    syncSlider(rotate);
    zoomVal.textContent = "100%";
    rotVal.textContent = "0°";
    setControlsEnabled(true);
    layoutSlot();
    setStatus("Photo prête. Glisse-la dans le cadre, puis ajuste le zoom et la rotation.");
  }

  function acceptedFile(file) {
    const type = (file.type || "").toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp") return true;
    return /\.(jpe?g|png|webp)$/i.test(file.name || "");
  }

  fileInput.addEventListener("change", function () {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (!acceptedFile(file)) {
      setStatus("Format non pris en charge. Utilise un JPG, un PNG ou un WebP.", true);
      shake(uploadLabel);
      return;
    }
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    state.photoReady = false;
    fileNote.textContent = file.name;
    userPhoto.src = state.objectUrl;
  });

  userPhoto.addEventListener("load", onPhotoReady);
  userPhoto.addEventListener("error", function () {
    state.photoReady = false;
    setControlsEnabled(false);
    setStatus("Cette image ne peut pas être lue. Essaie un autre fichier.", true);
  });

  photoSlot.addEventListener("pointerdown", function (event) {
    if (!state.photoReady) return;
    event.preventDefault();
    photoSlot.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    photoSlot.classList.add("is-dragging");
    userPhoto.style.willChange = "transform";
    if (pointers.size === 1) {
      dragOrigin = { panX: state.panX, panY: state.panY, x: event.clientX, y: event.clientY };
      pinchOrigin = null;
    } else if (pointers.size >= 2) {
      pinchOrigin = capturePinch();
      dragOrigin = null;
    }
  });

  function capturePinch() {
    const pts = Array.from(pointers.values());
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      scale: state.scale,
      panX: state.panX,
      panY: state.panY,
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2
    };
  }

  photoSlot.addEventListener("pointermove", function (event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = photoSlot.getBoundingClientRect();
    if (pointers.size >= 2) {
      if (!pinchOrigin) pinchOrigin = capturePinch();
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      state.scale = clamp(pinchOrigin.scale * (dist / pinchOrigin.dist), 1, 3);
      state.panX = pinchOrigin.panX + (midX - pinchOrigin.midX) / rect.width;
      state.panY = pinchOrigin.panY + (midY - pinchOrigin.midY) / rect.height;
      zoom.value = String(state.scale);
      syncSlider(zoom);
      zoomVal.textContent = Math.round(state.scale * 100) + "%";
    } else if (dragOrigin) {
      state.panX = dragOrigin.panX + (event.clientX - dragOrigin.x) / rect.width;
      state.panY = dragOrigin.panY + (event.clientY - dragOrigin.y) / rect.height;
    }
    applyTransform();
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size >= 2) {
      pinchOrigin = capturePinch();
      dragOrigin = null;
      return;
    }
    if (pointers.size === 1) {
      const remaining = Array.from(pointers.values())[0];
      dragOrigin = { panX: state.panX, panY: state.panY, x: remaining.x, y: remaining.y };
      pinchOrigin = null;
      return;
    }
    dragOrigin = null;
    pinchOrigin = null;
    photoSlot.classList.remove("is-dragging");
    userPhoto.style.willChange = "auto";
  }

  photoSlot.addEventListener("pointerup", endPointer);
  photoSlot.addEventListener("pointercancel", endPointer);

  photoSlot.addEventListener("wheel", function (event) {
    if (!state.photoReady) return;
    event.preventDefault();
    setScale(state.scale * (event.deltaY < 0 ? 1.06 : 0.94), true);
  }, { passive: false });

  zoom.addEventListener("input", function () {
    setScale(Number(zoom.value), true);
    markAdjusting();
  });
  rotate.addEventListener("input", function () {
    setRot(Number(rotate.value), true);
    markAdjusting();
  });

  document.getElementById("zoomIn").addEventListener("click", function () { if (state.photoReady) setScale(state.scale + 0.08); });
  document.getElementById("zoomOut").addEventListener("click", function () { if (state.photoReady) setScale(state.scale - 0.08); });
  document.getElementById("rotLeft").addEventListener("click", function () { if (state.photoReady) setRot(state.rot - 90); });
  document.getElementById("rotRight").addEventListener("click", function () { if (state.photoReady) setRot(state.rot + 90); });
  resetBtn.addEventListener("click", function () {
    if (!state.photoReady) return;
    state.panX = 0;
    state.panY = 0;
    setScale(1);
    setRot(0);
    setStatus("Cadrage réinitialisé.");
  });

  function renderBadge() {
    const nw = posterBase.naturalWidth;
    const nh = posterBase.naturalHeight;
    const exportScale = 2048 / Math.max(nw, nh);
    const out = document.createElement("canvas");
    out.width = Math.round(nw * exportScale);
    out.height = Math.round(nh * exportScale);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(posterBase, 0, 0, out.width, out.height);

    const fx = frame.x * exportScale;
    const fy = frame.y * exportScale;
    const fw = frame.w * exportScale;
    const fh = frame.h * exportScale;
    const frTop = frame.rTop * exportScale;
    const frBottom = frame.rBottom * exportScale;
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, frTop, frBottom);
    ctx.clip();
    const base = coverSize(userPhoto.naturalWidth, userPhoto.naturalHeight, fw, fh);
    ctx.translate(fx + fw / 2 + state.panX * fw, fy + fh / 2 + state.panY * fh);
    ctx.rotate((state.rot * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);
    ctx.drawImage(userPhoto, -base.w / 2, -base.h / 2, base.w, base.h);
    ctx.restore();
    ctx.drawImage(overlayCanvas, 0, 0, out.width, out.height);
    return out;
  }

  function burstAt(el) {
    if (reduceMotion) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 26; i++) {
      const angle = (Math.PI * 2 * i) / 26 + Math.random() * 0.2;
      const speed = 1.4 + Math.random() * 2.4;
      bursts.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 1,
        r: 1.2 + Math.random() * 1.8
      });
    }
  }

  downloadBtn.addEventListener("click", function () {
    if (!frame) {
      setStatus("L'affiche est encore en cours de préparation.", true);
      return;
    }
    if (!state.photoReady) {
      setStatus("Ajoute ta photo pour créer le badge.", true);
      shake(uploadLabel);
      return;
    }
    if (state.exporting) return;
    state.exporting = true;
    downloadBtn.classList.add("is-busy");
    setStatus("Préparation du badge…");
    burstAt(downloadBtn);

    window.setTimeout(function () {
      try {
        const canvas = renderBadge();
        canvas.toBlob(function (blob) {
          state.exporting = false;
          downloadBtn.classList.remove("is-busy");
          if (!blob) {
            setStatus("Le badge n'a pas pu être créé. Réessaie.", true);
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "badge-jy-serai-kds-2026.png";
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
          setStatus("Ton badge est téléchargé · " + canvas.width + "×" + canvas.height + ".");
        }, "image/png");
      } catch (error) {
        state.exporting = false;
        downloadBtn.classList.remove("is-busy");
        setStatus("Le badge n'a pas pu être créé. Réessaie.", true);
      }
    }, 40);
  });

  function resizeSparks() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    sparkCanvas.width = Math.round(window.innerWidth * dpr);
    sparkCanvas.height = Math.round(window.innerHeight * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawSparks() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    sctx.clearRect(0, 0, width, height);
    sparks.forEach(function (spark) {
      spark.y -= spark.vy;
      spark.x += Math.sin(spark.y * 0.02 + spark.phase) * 0.28;
      spark.alpha -= 0.0035;
      if (spark.y < -6 || spark.alpha <= 0) {
        spark.x = Math.random() * width;
        spark.y = height + 6;
        spark.alpha = 0.45 + Math.random() * 0.55;
      }
      sctx.globalAlpha = Math.max(spark.alpha, 0);
      sctx.fillStyle = spark.bright ? "#fff6d0" : "#f0cb6e";
      sctx.beginPath();
      sctx.arc(spark.x, spark.y, spark.r, 0, Math.PI * 2);
      sctx.fill();
    });
    for (let i = bursts.length - 1; i >= 0; i--) {
      const bit = bursts[i];
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.vy += 0.035;
      bit.life -= 0.018;
      if (bit.life <= 0) {
        bursts.splice(i, 1);
        continue;
      }
      sctx.globalAlpha = Math.max(bit.life, 0);
      sctx.fillStyle = "#ffe7a8";
      sctx.beginPath();
      sctx.arc(bit.x, bit.y, bit.r, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;
  }

  function startSparks() {
    if (reduceMotion || sparkLoop) return;
    resizeSparks();
    const count = window.innerWidth < 720 ? 16 : 34;
    sparks = [];
    for (let i = 0; i < count; i++) {
      sparks.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 0.6 + Math.random() * 1.7,
        vy: 0.18 + Math.random() * 0.45,
        phase: Math.random() * Math.PI * 2,
        alpha: Math.random(),
        bright: Math.random() > 0.35
      });
    }
    sparkLoop = true;
    sparkCanvas.style.zIndex = "12";
    const loop = function () {
      if (!sparkLoop) return;
      drawSparks();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", function () {
    if (reduceMotion) return;
    if (document.hidden) {
      sparkLoop = false;
    } else if (!sparkLoop) {
      sparkLoop = true;
      const loop = function () {
        if (!sparkLoop) return;
        drawSparks();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  });

  window.addEventListener("resize", function () {
    if (!reduceMotion) resizeSparks();
    layoutSlot();
  });

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(function () { layoutSlot(); });
    observer.observe(posterFrame);
  }

  function finishIntro(immediate) {
    if (immediate) document.body.classList.add("skip-motion");
    document.body.classList.add("curtains-open", "ready");
    intro.inert = true;
    sparkCanvas.style.zIndex = "0";
    window.setTimeout(function () { intro.hidden = true; }, immediate ? 0 : 480);
  }

  function beginIntro() {
    if (reduceMotion) {
      finishIntro(true);
      return;
    }
    const openTimer = window.setTimeout(function () {
      document.body.classList.add("curtains-open");
    }, 1050);
    const endTimer = window.setTimeout(function () { finishIntro(false); }, 2550);
    document.getElementById("skipIntro").addEventListener("click", function () {
      clearTimeout(openTimer);
      clearTimeout(endTimer);
      finishIntro(true);
    });
  }

  syncSlider(zoom);
  syncSlider(rotate);
  setControlsEnabled(false);
  startSparks();
  beginIntro();

  if (posterBase.complete && posterBase.naturalWidth) preparePoster();
  else posterBase.addEventListener("load", preparePoster);
  posterBase.addEventListener("error", function () {
    setStatus("L'affiche n'a pas pu être chargée.", true);
  });
})();
