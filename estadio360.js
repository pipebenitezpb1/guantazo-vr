// Dibuja un estadio 360° ORIGINAL en formato equirectangular (proporción 2:1).
// Columna x = longitud (0..360°), fila y = latitud (+90° arriba, -90° abajo); el horizonte está en H/2.
// El centro de la imagen (x = W/2) queda detrás del rival, mirando hacia adelante.
export function drawArena360(W = 4096, H = 2048) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Dibuja también en x ± W cuando el objeto cruza el borde, para que no se vea la costura.
  const wrap = (x, half, fn) => { fn(x); if (x < half) fn(x + W); if (x > W - half) fn(x - W); };
  const font = (px, w = 800) => `${w} ${px}px "M PLUS Rounded 1c", "Nunito", system-ui, sans-serif`;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

  // --- Techo: cúpula clara y luminosa ---
  let gr = g.createLinearGradient(0, 0, 0, H * 0.5);
  gr.addColorStop(0, '#f4f8fd'); gr.addColorStop(0.5, '#dce8f5'); gr.addColorStop(1, '#bcd2ea');
  g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.5);
  // costillas de la cúpula
  g.strokeStyle = 'rgba(120,150,190,0.25)'; g.lineWidth = 5;
  for (let i = 0; i < 32; i++) { const x = i / 32 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * 0.26); g.stroke(); }
  for (const y of [0.08, 0.16, 0.24]) { g.fillStyle = 'rgba(120,150,190,0.22)'; g.fillRect(0, H * y, W, 6); }
  // paneles de luz suave
  for (let i = 0; i < 16; i++) {
    const x = (i + 0.5) / 16 * W, y = H * 0.2;
    wrap(x, 160, (xx) => {
      const rg = g.createRadialGradient(xx, y, 6, xx, y, 160);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.7)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(xx - 160, y - 160, 320, 320);
    });
  }

  // --- Banda de pantallas ---
  const bandY = H * 0.275, bandH = H * 0.04;
  g.fillStyle = '#2f4f7a'; g.fillRect(0, bandY, W, bandH);
  g.fillStyle = '#5aa9e6'; g.fillRect(0, bandY + bandH * 0.12, W, bandH * 0.76);
  g.font = font(bandH * 0.5); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) g.fillText(i % 2 ? '★ ¡GUANTAZO! ★' : 'ROUND · KO · COMBO', (i + 0.5) / 12 * W, bandY + bandH * 0.52);

  // marcadores colgantes en 4 direcciones (el principal al frente, x = W/2)
  [[0.5, '¡GUANTAZO!', 1.2], [0, 'ROUND', 0.9], [0.25, '¡POW!', 0.9], [0.75, '¡ZAS!', 0.9]].forEach(([u, t, s]) => {
    const x = u * W, w = 520 * s, h = 150 * s, y = H * 0.135;
    wrap(x, w, (xx) => {
      g.fillStyle = 'rgba(40,60,90,0.18)'; rr(xx - w / 2 + 8, y + 10, w, h, 34); g.fill();
      g.fillStyle = '#ffffff'; rr(xx - w / 2, y, w, h, 34); g.fill();
      g.fillStyle = '#5aa9e6'; rr(xx - w / 2 + 14, y + 14, w - 28, h - 28, 24); g.fill();
      g.fillStyle = '#ffffff'; g.font = font(h * 0.46); g.fillText(t, xx, y + h * 0.53);
    });
  });

  // --- Gradas con público de figuras simples ---
  const top = H * 0.318, bottom = H * 0.525, rows = 12, rowH = (bottom - top) / rows;
  const shirts = ['#ff8a8a', '#ffc46b', '#8fd694', '#7cc4f2', '#b9a3f0', '#ff9fc8', '#ffffff', '#f6e27a', '#86d8d0'];
  const skins = ['#ffe0c2', '#f4c49c', '#d9a073', '#a8704a', '#7a4f33'];
  for (let r = 0; r < rows; r++) {
    const y0 = top + r * rowH;
    g.fillStyle = r % 2 ? '#c9d6e6' : '#d6e1ee'; g.fillRect(0, y0, W, rowH);
    g.fillStyle = 'rgba(80,110,150,0.25)'; g.fillRect(0, y0 + rowH - 3, W, 3);
    const n = Math.floor(W / (rowH * 0.95));
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.08) continue; // asientos vacíos
      const x = (k + 0.3 + rnd() * 0.4) / n * W;
      const bw = rowH * 0.62, bh = rowH * 0.55, hr = rowH * 0.2;
      const shirt = shirts[Math.floor(rnd() * shirts.length)], skin = skins[Math.floor(rnd() * skins.length)];
      const cheering = rnd() < 0.18, sign = rnd() < 0.04;
      wrap(x, rowH, (xx) => {
        g.fillStyle = shirt; rr(xx - bw / 2, y0 + rowH - bh, bw, bh, bw * 0.45); g.fill();
        g.fillStyle = skin; g.beginPath(); g.arc(xx, y0 + rowH - bh - hr * 0.6, hr, 0, Math.PI * 2); g.fill();
        if (cheering) { g.fillStyle = skin; for (const s of [-1, 1]) { g.beginPath(); g.arc(xx + s * bw * 0.55, y0 + rowH - bh - hr * 1.6, hr * 0.42, 0, Math.PI * 2); g.fill(); } }
        if (sign) { g.fillStyle = '#ffffff'; rr(xx - bw * 0.7, y0 + rowH - bh - hr * 3.2, bw * 1.4, hr * 1.6, 4); g.fill(); g.fillStyle = '#ff6b6b'; g.font = font(hr * 1.2); g.fillText('!', xx, y0 + rowH - bh - hr * 2.35); }
      });
    }
  }

  // --- Valla con carteles propios ---
  const wallY = bottom, wallH = H * 0.03;
  g.fillStyle = '#ffffff'; g.fillRect(0, wallY, W, wallH);
  const ads = ['¡GUANTAZO!', '¡PUM!', 'GANCHO', '¡ZAS!'];
  const adCols = ['#5aa9e6', '#ff8a8a', '#8fd694', '#ffc46b'];
  for (let i = 0; i < 16; i++) {
    const x0 = i / 16 * W;
    g.fillStyle = adCols[i % 4]; rr(x0 + 10, wallY + 6, W / 16 - 20, wallH - 12, 10); g.fill();
    g.fillStyle = '#ffffff'; g.font = font(wallH * 0.48); g.fillText(ads[i % 4], x0 + W / 32, wallY + wallH * 0.53);
  }

  // --- Piso del estadio ---
  gr = g.createLinearGradient(0, wallY + wallH, 0, H);
  gr.addColorStop(0, '#9fb4cc'); gr.addColorStop(0.3, '#c3d1e0'); gr.addColorStop(1, '#e3eaf2');
  g.fillStyle = gr; g.fillRect(0, wallY + wallH, W, H - wallY - wallH);
  return c;
}
