const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');

  const glyphSourcePath = 'C:/Users/3hillachu/.gemini/antigravity/brain/b24dc918-926e-4366-90f9-48148299133e/.user_uploaded/media_1793230310382_5a7b3be1.png';
  const glyphB64 = fs.readFileSync(glyphSourcePath).toString('base64');

  const generated = await win.webContents.executeJavaScript(`
    (async () => {
      // 1. Load source image
      const srcImg = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = "data:image/png;base64,${glyphB64}";
      });

      // 2. Extract pure alpha mask of the triangle glyph
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = srcImg.width;
      srcCanvas.height = srcImg.height;
      const sCtx = srcCanvas.getContext('2d');
      sCtx.drawImage(srcImg, 0, 0);
      const srcData = sCtx.getImageData(0, 0, srcImg.width, srcImg.height);
      const sD = srcData.data;

      // Glyph bbox in source:
      // minX: 202, maxX: 842, minY: 182, maxY: 741, cx: 522, cy: 461.5
      const glyphCanvas = document.createElement('canvas');
      const gW = 641;
      const gH = 560;
      glyphCanvas.width = gW;
      glyphCanvas.height = gH;
      const gCtx = glyphCanvas.getContext('2d');
      const glyphImgData = gCtx.createImageData(gW, gH);
      const gD = glyphImgData.data;

      const minX = 202;
      const minY = 182;

      for (let y = 0; y < gH; y++) {
        for (let x = 0; x < gW; x++) {
          const sX = minX + x;
          const sY = minY + y;
          const sIdx = (sY * srcImg.width + sX) * 4;
          const gIdx = (y * gW + x) * 4;

          const origA = sD[sIdx + 3];
          if (origA < 10) {
            // Transparent in source
            gD[gIdx] = 0;
            gD[gIdx + 1] = 0;
            gD[gIdx + 2] = 0;
            gD[gIdx + 3] = 0;
            continue;
          }

          const r = sD[sIdx];
          const g = sD[sIdx + 1];
          const b = sD[sIdx + 2];
          const gray = (r * 0.299) + (g * 0.587) + (b * 0.114);

          if (gray > 235) {
            // White inside the circular disc -> transparent
            gD[gIdx] = 0;
            gD[gIdx + 1] = 0;
            gD[gIdx + 2] = 0;
            gD[gIdx + 3] = 0;
          } else {
            // Black / anti-aliased stroke -> preserve alpha
            const alpha = Math.max(0, Math.min(255, Math.round((255 - gray) * (origA / 255))));
            gD[gIdx] = 255;
            gD[gIdx + 1] = 255;
            gD[gIdx + 2] = 255;
            gD[gIdx + 3] = alpha;
          }
        }
      }
      gCtx.putImageData(glyphImgData, 0, 0);

      // Helper function to draw colored glyph onto a target canvas
      function drawGlyph(ctx, targetX, targetY, targetW, targetH, r, g, b, alphaMul = 1.0) {
        // Create colored version
        const tempC = document.createElement('canvas');
        tempC.width = gW;
        tempC.height = gH;
        const tCtx = tempC.getContext('2d');
        tCtx.drawImage(glyphCanvas, 0, 0);

        // Multiply color
        tCtx.globalCompositeOperation = 'source-in';
        tCtx.fillStyle = \`rgba(\${r}, \${g}, \${b}, \${alphaMul})\`;
        tCtx.fillRect(0, 0, gW, gH);

        // Draw scaled to target
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tempC, targetX, targetY, targetW, targetH);
      }

      // --- 1. PURE WHITE GLYPH (100% TRANSPARENT BACKGROUND FOR DARK MODE) ---
      const whiteCanvas = document.createElement('canvas');
      whiteCanvas.width = 512;
      whiteCanvas.height = 512;
      const wCtx = whiteCanvas.getContext('2d');
      wCtx.clearRect(0, 0, 512, 512);

      // Desired glyph size: width ~400, height = 400 * (560/641) = ~349
      const whiteW = 400;
      const whiteH = Math.round(whiteW * (gH / gW));
      const whiteX = Math.round((512 - whiteW) / 2);
      const whiteY = Math.round((512 - whiteH) / 2);
      drawGlyph(wCtx, whiteX, whiteY, whiteW, whiteH, 255, 255, 255, 1.0);

      // --- 2. PURE DARK SLATE GLYPH (100% TRANSPARENT BACKGROUND FOR LIGHT MODE) ---
      const darkCanvas = document.createElement('canvas');
      darkCanvas.width = 512;
      darkCanvas.height = 512;
      const dCtx = darkCanvas.getContext('2d');
      dCtx.clearRect(0, 0, 512, 512);
      drawGlyph(dCtx, whiteX, whiteY, whiteW, whiteH, 15, 23, 42, 1.0);

      // --- 3. MASTER WHITE LAUNCHER / TASKBAR SQUIRCLE CARD ---
      // 512x512 card: 436x436 at (38, 38) with radius 102px
      const cardCanvas = document.createElement('canvas');
      cardCanvas.width = 512;
      cardCanvas.height = 512;
      const cCtx = cardCanvas.getContext('2d');
      cCtx.clearRect(0, 0, 512, 512);

      const cardSize = 436;
      const cardRadius = 102;
      const cardX = 38;
      const cardY = 38;

      // Subtle drop shadow under squircle
      function drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
      }

      // Shadow layers
      cCtx.save();
      cCtx.fillStyle = 'rgba(0, 0, 0, 0.10)';
      cCtx.filter = 'blur(10px)';
      drawRoundedRect(cCtx, cardX, cardY + 8, cardSize, cardSize, cardRadius);
      cCtx.fill();
      cCtx.restore();

      cCtx.save();
      cCtx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      cCtx.filter = 'blur(4px)';
      drawRoundedRect(cCtx, cardX, cardY + 3, cardSize, cardSize, cardRadius);
      cCtx.fill();
      cCtx.restore();

      // Squircle fill: pure white
      cCtx.save();
      cCtx.fillStyle = '#ffffff';
      drawRoundedRect(cCtx, cardX, cardY, cardSize, cardSize, cardRadius);
      cCtx.fill();

      // Subtle inner border
      cCtx.lineWidth = 1.5;
      cCtx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      cCtx.stroke();
      cCtx.restore();

      // Centered dark glyph inside white squircle card
      // Size: width ~296, height = 296 * (560/641) = ~258
      const cgW = 296;
      const cgH = Math.round(cgW * (gH / gW));
      const cgX = Math.round((512 - cgW) / 2);
      const cgY = Math.round((512 - cgH) / 2);
      drawGlyph(cCtx, cgX, cgY, cgW, cgH, 15, 23, 42, 1.0);

      // Function to sample corner and center
      function sample(cvs) {
        const ctx = cvs.getContext('2d');
        const p00 = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        const p10 = Array.from(ctx.getImageData(10, 10, 1, 1).data);
        const pMid = Array.from(ctx.getImageData(256, 256, 1, 1).data);
        return { p00, p10, pMid };
      }

      // Helper to generate scaled bitmaps for ICO
      const icoSizes = [256, 128, 64, 48, 32, 24, 16];
      const icoDataMap = {};
      for (const sz of icoSizes) {
        const sc = document.createElement('canvas');
        sc.width = sz;
        sc.height = sz;
        const sctx = sc.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(cardCanvas, 0, 0, sz, sz);
        icoDataMap[sz] = sc.toDataURL('image/png').split(',')[1];
      }

      return {
        whiteB64: whiteCanvas.toDataURL('image/png').split(',')[1],
        darkB64: darkCanvas.toDataURL('image/png').split(',')[1],
        cardB64: cardCanvas.toDataURL('image/png').split(',')[1],
        samples: {
          white: sample(whiteCanvas),
          dark: sample(darkCanvas),
          card: sample(cardCanvas)
        },
        icoDataMap
      };
    })()
  `);

  console.log('SAMPLE_RESULTS:', JSON.stringify(generated.samples, null, 2));

  // Write files to src/ui/assets, dist/ui/assets, and build/
  const whiteBuf = Buffer.from(generated.whiteB64, 'base64');
  const darkBuf = Buffer.from(generated.darkB64, 'base64');
  const cardBuf = Buffer.from(generated.cardB64, 'base64');

  const targets = [
    { buf: whiteBuf, paths: ['src/ui/assets/logo-dark.png', 'dist/ui/assets/logo-dark.png', 'src/ui/assets/logo-white.png', 'dist/ui/assets/logo-white.png'] },
    { buf: darkBuf, paths: ['src/ui/assets/logo-light.png', 'dist/ui/assets/logo-light.png', 'src/ui/assets/logo-glyph.png', 'dist/ui/assets/logo-glyph.png'] },
    { buf: cardBuf, paths: ['build/icon.png', 'src/ui/assets/logo.png', 'dist/ui/assets/logo.png', 'src/ui/assets/logo-badge.png', 'dist/ui/assets/logo-badge.png'] }
  ];

  for (const t of targets) {
    for (const p of t.paths) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, t.buf);
      console.log('Saved:', p, t.buf.length, 'bytes');
    }
  }

  // Build icon.ico
  const icoSizes = [256, 128, 64, 48, 32, 24, 16];
  const pngBuffers = icoSizes.map(sz => ({ sz, buf: Buffer.from(generated.icoDataMap[sz], 'base64') }));

  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + dirEntrySize * pngBuffers.length;

  const icoBuf = Buffer.alloc(offset + pngBuffers.reduce((acc, x) => acc + x.buf.length, 0));
  icoBuf.writeUInt16LE(0, 0); // reserved
  icoBuf.writeUInt16LE(1, 2); // type 1 = ICO
  icoBuf.writeUInt16LE(pngBuffers.length, 4); // image count

  for (let i = 0; i < pngBuffers.length; i++) {
    const { sz, buf } = pngBuffers[i];
    const entryOffset = headerSize + i * dirEntrySize;
    icoBuf.writeUInt8(sz === 256 ? 0 : sz, entryOffset); // width
    icoBuf.writeUInt8(sz === 256 ? 0 : sz, entryOffset + 1); // height
    icoBuf.writeUInt8(0, entryOffset + 2); // color count
    icoBuf.writeUInt8(0, entryOffset + 3); // reserved
    icoBuf.writeUInt16LE(1, entryOffset + 4); // color planes
    icoBuf.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    icoBuf.writeUInt32LE(buf.length, entryOffset + 8); // image size
    icoBuf.writeUInt32LE(offset, entryOffset + 12); // image offset

    buf.copy(icoBuf, offset);
    offset += buf.length;
  }

  fs.writeFileSync('build/icon.ico', icoBuf);
  console.log('Saved build/icon.ico:', icoBuf.length, 'bytes');

  app.quit();
});
