/* 宸玑 v5 首页：手写 WebGL 圆柱主视觉（无第三方库）。
   画面：橙底 + 圆柱内壁深色网格（随透视弯曲、两侧压暗）→ 背面卡片 → 品牌大字（z=0 平面）→ 正面卡片。
   交互：滚动/滚轮/横向拖动给圆柱角速度，松手后按指数衰减；空闲慢速自转；环带上下无限循环；速度越快卡片越弯。
   降级：无 WebGL / 缺导数扩展 / ?fallback=1 → CSS 静态兜底；prefers-reduced-motion → WebGL 只画静止一帧，不自转不惯性。 */
(function () {
  'use strict';
  var root = document.documentElement;
  var rm = matchMedia('(prefers-reduced-motion: reduce)');
  // —— 菜单 ——
  var btn = document.querySelector('.burger'), nav = document.getElementById('nav'), bar = document.getElementById('bar');
  function menu(open) { root.classList.toggle('menu-open', open); btn.setAttribute('aria-expanded', open); btn.firstChild.textContent = open ? '关闭菜单' : '打开菜单'; }
  btn.addEventListener('click', function () { menu(!root.classList.contains('menu-open')); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) menu(false); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') menu(false); });
  var wrap = document.querySelector('.stage-wrap'), stage = document.querySelector('.stage');
  function onScrollBar() { bar.classList.toggle('dark', scrollY > wrap.offsetHeight - 60); }
  addEventListener('scroll', onScrollBar, { passive: true }); onScrollBar();

  // —— 圆点光标 ——
  if (matchMedia('(pointer:fine)').matches && !rm.matches) {
    var cur = document.querySelector('.cursor'); root.classList.add('has-cursor');
    stage.addEventListener('pointermove', function (e) {
      cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; root.classList.add('cur-on');
      cur.classList.toggle('big', !!e.target.closest('a,button'));
    });
    stage.addEventListener('pointerleave', function () { root.classList.remove('cur-on'); });
    bar.addEventListener('pointerenter', function () { root.classList.remove('cur-on'); });
  }

  // —— 模式切换按钮（无 GL 时隐藏） ——
  var modeBtns = [].slice.call(document.querySelectorAll('.mode-b')), modeTarget = 0;
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      modeTarget = b.dataset.mode === 'spiral' ? 1 : 0;
      modeBtns.forEach(function (o) { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', o === b); });
      if (window.__cyl) window.__cyl.kick();
    });
  });

  var CFG = window.CJ_CARDS || { count: 60, perRing: 10, images: [] };
  var cv = document.getElementById('cyl');
  function noGL(why) { root.classList.add('no-gl'); root.dataset.hero = 'static' + (why ? '-' + why : ''); }
  if (/[?&]fallback=1/.test(location.search)) return noGL('forced');
  var gl = null;
  try { gl = cv.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' }); } catch (e) {}
  if (!gl || !gl.getExtension('OES_standard_derivatives')) return noGL('nogl');

  // —— 着色器 ——
  var ORANGE = [1, 0.357, 0.078], INK = [0.086, 0.059, 0.043];
  var VS_BG = 'attribute vec2 p;varying vec2 n;void main(){n=p;gl_Position=vec4(p,0.,1.);}';
  var FS_BG = '#extension GL_OES_standard_derivatives : enable\nprecision highp float;varying vec2 n;' +
    'uniform vec2 uTan;uniform float uCam,uRg,uRot,uY,uCell;uniform vec3 uBg,uInk;' +
    'void main(){vec3 d=normalize(vec3(n.x*uTan.x,n.y*uTan.y,-1.));' +
    // 射线与内壁圆柱 x²+z²=Rg² 的远交点（相机在圆柱内）
    'float a=d.x*d.x+d.z*d.z,b=2.*uCam*d.z,c=uCam*uCam-uRg*uRg;float t=(-b+sqrt(b*b-4.*a*c))/(2.*a);vec3 h=vec3(0.,0.,uCam)+d*t;' +
    'float phi=atan(h.x,-h.z);vec2 g=vec2((phi+uRot*.35)*uRg,h.y+uY*.35)/uCell;' +
    'vec2 f=abs(fract(g-.5)-.5)/fwidth(g);float line=1.-clamp(min(f.x,f.y)-.25,0.,1.);' +
    'float side=smoothstep(.15,1.05,abs(n.x));float vert=smoothstep(.55,1.15,abs(n.y))*.35;' +
    'vec3 col=mix(uBg,uInk,line*.62);col=mix(col,uInk,side*.5+vert);gl_FragColor=vec4(col,1.);}';
  var VS_CARD = 'precision highp float;attribute vec3 a;' +
    'uniform mat4 uP;uniform float uCam,uR,uW,uH,uRot,uY,uL,uGap,uPer,uMorph,uBend,uT,uWave,uCount,uCols,uRows;' +
    'varying vec2 vUv;varying float vFog,vShade,vZ,vYc,vFront;' +
    'void main(){float i=a.z;float ring=floor(i/uPer),k=mod(i,uPer);float TAU=6.2831853;' +
    // 环带整体偏半圈：静止时正中视平线没有一圈卡片，字落在上下环带之间
    'float thR=k*TAU/uPer+mod(ring,2.)*TAU/uPer*.5,yR=ring*uGap+uGap*.5;float thS=i*TAU/uPer,yS=i*uGap/uPer+uGap*.5;' +
    'float th=mix(thR,thS,uMorph),y0=mix(yR,yS,uMorph);' +
    'float y=mod(y0+uY+uL*.5,uL)-uL*.5;' +
    'float u=a.x,v=a.y;float ang=th+uRot+u*uW/uR;' +
    // 布料弯曲：速度越大，横向两端越往后拖、纵向起波；平时只有轻微呼吸波动
    'float bend=uBend;float wave=uWave*sin(uT*1.3+th*3.+y*1.7+u*4.);' +
    'float dy=bend*.42*(u*u*4.-.33)+wave*.06+bend*.12*sin(u*6.2+uT*4.)*v;' +
    'float dr=-abs(bend)*.35*(u*u*4.)+bend*.18*sin(u*9.+v*3.+uT*5.)+wave*.05;' +
    'float r=uR+dr;vec3 P=vec3(r*sin(ang),y+v*uH+dy,r*cos(ang));' +
    'vZ=P.z;vYc=y;vFront=cos(ang);gl_Position=uP*vec4(P.x,P.y,P.z-uCam,1.);' +
    'float idx=mod(i,uCount);vUv=vec2((mod(idx,uCols)+u+.5)/uCols,(floor(idx/uCols)+.5-v)/uRows);' +
    'float depth=uCam-P.z;vFog=smoothstep(uCam-uR*.2,uCam+uR*1.05,depth)*.82;' +
    'vFog=max(vFog,smoothstep(uL*.36,uL*.5,abs(y)));' +
    'vShade=.62+.38*max(cos(ang),0.);}';
  var FS_CARD = 'precision highp float;uniform sampler2D uTex;uniform vec3 uBg;uniform float uSide,uClear;' +
    'varying vec2 vUv;varying float vFog,vShade,vZ,vYc,vFront;' +
    // 正面朝镜头且落在正中一字带内的卡片不画（字清楚可读）；侧面绕行、上下环带、背面卡片保留
    'void main(){if(uSide*vZ<0.)discard;if(uSide>0.&&abs(vYc)<uClear)discard;' +
    'vec3 c=texture2D(uTex,vUv).rgb;if(!gl_FrontFacing)c*=.8;' +
    'c*=vShade;gl_FragColor=vec4(mix(c,uBg,vFog),1.);}';
  var VS_TXT = 'attribute vec2 p;uniform mat4 uP;uniform vec2 uS;uniform float uCam;varying vec2 t;' +
    'void main(){t=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=uP*vec4(p*uS,-uCam,1.);}';
  var FS_TXT = 'precision mediump float;uniform sampler2D uTex;varying vec2 t;void main(){vec4 c=texture2D(uTex,t);if(c.a<0.08)discard;gl_FragColor=vec4(c.rgb,1.);}';

  function prog(vs, fs) {
    var p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(function (s) {
      var sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    });
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p: p, u: u, a: gl.getAttribLocation(p, vs.indexOf('attribute vec3 a') >= 0 ? 'a' : 'p') };
  }
  var PB, PC, PT;
  try { PB = prog(VS_BG, FS_BG); PC = prog(VS_CARD, FS_CARD); PT = prog(VS_TXT, FS_TXT); } catch (e) { console.warn(e); return noGL('shader'); }

  var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  // —— 卡片网格：每张 12×6 段 ——
  var SU = 12, SV = 6, cardBuf = gl.createBuffer(), cardIdx = gl.createBuffer(), nIdx = 0, nCards = 0;
  function buildCards(n) {
    nCards = n; var vtx = [], idx = [], per = (SU + 1) * (SV + 1);
    for (var c = 0; c < n; c++) {
      for (var j = 0; j <= SV; j++) for (var i = 0; i <= SU; i++) vtx.push(i / SU - .5, j / SV - .5, c);
      for (j = 0; j < SV; j++) for (i = 0; i < SU; i++) {
        var o = c * per + j * (SU + 1) + i; idx.push(o, o + 1, o + SU + 1, o + 1, o + SU + 2, o + SU + 1);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vtx), gl.STATIC_DRAW);
    var big = n * per > 65535, ext = big && gl.getExtension('OES_element_index_uint');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cardIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ext ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
    cardIdx.type = ext ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; nIdx = idx.length;
  }

  // —— 卡片图集：留白占位「产品图 NN」，配置了图片的格子画真图 ——
  var COUNT = CFG.count || 60, COLS = 8, ROWS = Math.ceil(COUNT / COLS), CW = 256, CH = 192;
  var atlas = document.createElement('canvas'); atlas.width = CW * COLS; atlas.height = CH * ROWS;
  var ax = atlas.getContext('2d'), texCard = gl.createTexture(), texTxt = gl.createTexture();
  function cell(i, img) {
    var x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    ax.save(); ax.beginPath(); ax.rect(x, y, CW, CH); ax.clip();
    ax.fillStyle = i % 3 === 1 ? '#ebe4d8' : '#f4eee3'; ax.fillRect(x, y, CW, CH);
    if (img) { var s = Math.max(CW / img.width, CH / img.height); ax.drawImage(img, x + (CW - img.width * s) / 2, y + (CH - img.height * s) / 2, img.width * s, img.height * s); }
    else {
      ax.strokeStyle = 'rgba(22,15,11,.22)'; ax.lineWidth = 1; ax.setLineDash([4, 4]); ax.strokeRect(x + 78.5, y + 52.5, 99, 75); ax.setLineDash([]);
      ax.beginPath(); ax.moveTo(x + 79, y + 53); ax.lineTo(x + 177, y + 127); ax.moveTo(x + 177, y + 53); ax.lineTo(x + 79, y + 127); ax.stroke();
      ax.fillStyle = '#8f857c'; ax.font = '500 17px "Chenji Sans",sans-serif'; ax.textBaseline = 'alphabetic';
      ax.fillText('产品图 ' + (i + 1 < 10 ? '0' : '') + (i + 1), x + 14, y + CH - 14);
      ax.font = '500 11px "Chenji Sans",sans-serif'; ax.textAlign = 'right'; ax.fillText('CJ—' + (i + 1 < 10 ? '0' : '') + (i + 1), x + CW - 14, y + 22); ax.textAlign = 'left';
    }
    ax.strokeStyle = 'rgba(22,15,11,.55)'; ax.lineWidth = 3; ax.strokeRect(x + 1.5, y + 1.5, CW - 3, CH - 3);
    ax.restore();
  }
  function upload(tex, src) {
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    dirty = true;
  }
  function paintAtlas() { for (var i = 0; i < COUNT; i++) cell(i, null); upload(texCard, atlas); }
  (CFG.images || []).forEach(function (src, i) {
    if (!src || i >= COUNT) return;
    var im = new Image(); im.onload = function () { cell(i, im); upload(texCard, atlas); }; im.src = src;
  });

  // —— 品牌大字纹理 ——
  var txt = document.createElement('canvas'), tx = txt.getContext('2d'), TITLE = document.getElementById('h1').textContent.trim(), txtAspect = 4;
  function paintTitle() {
    txt.width = 2048; txt.height = 560; tx.clearRect(0, 0, 2048, 560);
    tx.font = '900 400px "Chenji Sans","Noto Sans SC",sans-serif';
    var w = tx.measureText(TITLE).width, s = Math.min(1, 1960 / w);
    tx.font = '900 ' + Math.floor(400 * s) + 'px "Chenji Sans","Noto Sans SC",sans-serif';
    w = tx.measureText(TITLE).width; txtAspect = 2048 / 560;
    tx.fillStyle = '#160f0b'; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillText(TITLE, 1024, 300);
    txt.fillW = w / 2048; upload(texTxt, txt);
  }

  // —— 状态 ——
  var W = 0, H = 0, asp = 1, cam = 10, R = 4.2, GAP = 3.6, L = 21.6, FOV = 40, tanY = Math.tan(FOV * Math.PI / 360);
  var CARD_W = 1.7, CARD_H = 1.28, PER = CFG.perRing || 10, Proj = new Float32Array(16);
  var rot = 0, yOff = 0, vel = 0, dir = 1, bend = 0, morph = 0, clearY = 1.2, last = 0, t0 = performance.now(), dirty = true, raf = 0, visible = true;
  var still = rm.matches, REC = /[?&]rec=1/.test(location.search), vnow = 0;   // ?rec=1：录屏用，停掉 rAF，由 __cyl.tick(ms) 逐帧推进
  function resize() {
    var dpr = Math.min(devicePixelRatio || 1, 2), r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); asp = W / H;
    if (W * H * dpr * dpr > 4.2e6) dpr = Math.sqrt(4.2e6 / (W * H));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    // 竖屏拉远相机，让圆柱约占满屏宽
    // 横屏：圆柱约占屏宽一半；竖屏：缩小圆柱与卡片，圆柱约占满屏宽
    var port = asp < 1;
    R = port ? 2.4 : 4.2; GAP = port ? 3.0 : 3.6; CARD_W = port ? 1.18 : 1.7; CARD_H = port ? 0.88 : 1.28;
    cam = port ? Math.max(8, (R * 1.3) / (tanY * asp)) : 13;
    var halfBack = (cam + R) * tanY, rings = Math.max(6, Math.ceil(halfBack * 2 * 1.04 / GAP));
    L = rings * GAP; if (nCards !== rings * PER) buildCards(rings * PER);
    var f = 1 / tanY, n = .1, fa = 100;
    Proj.set([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]);
    dirty = true;
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    var t = (now - t0) / 1000;
    if (!still) {
      vel *= Math.exp(-dt * 2.4);                       // 惯性：指数衰减
      if (Math.abs(vel) > .02) dir = vel > 0 ? 1 : -1;
      var spin = vel + dir * .12;                       // 空闲慢速自转（方向跟随最后一次拨动）
      rot += spin * dt;
      // 只有用户滚动/拖动产生的速度才带动环带上下，避免空闲自转把卡片转到正中字上
      yOff += vel * dt * .55;
      var tb = Math.max(-1, Math.min(1, vel / 3.2)); bend += (tb - bend) * Math.min(1, dt * 6);
    }
    morph += (modeTarget - morph) * (still ? 1 : Math.min(1, dt * 3.5));
    if (raf === 0 && document.getElementById('idx') && ((now | 0) % 6 === 0 || still)) updIdx();
    draw(still ? 0 : t);
    if (!still && visible && !REC) raf = requestAnimationFrame(frame);
  }
  function draw(t) {
    gl.viewport(0, 0, cv.width, cv.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    // 1 背景网格
    gl.useProgram(PB.p); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(PB.a); gl.vertexAttribPointer(PB.a, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(PB.u.uTan, tanY * asp, tanY); gl.uniform1f(PB.u.uCam, cam); gl.uniform1f(PB.u.uRg, cam + 3.5);
    gl.uniform1f(PB.u.uRot, rot); gl.uniform1f(PB.u.uY, yOff); gl.uniform1f(PB.u.uCell, 1.1);
    gl.uniform3fv(PB.u.uBg, ORANGE); gl.uniform3fv(PB.u.uInk, INK); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(PB.a);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // 2 背面卡片 → 3 大字 → 4 正面卡片
    // 正中一字带半高：标题半高 + 卡片半高余量；正面朝向且落入此带的卡片不画
    var halfW = cam * tanY * asp, tw = halfW * (asp >= 1 ? .56 : .62) / (txt.fillW || 1);
    clearY = tw / txtAspect * 0.55 + CARD_H * 0.65 + 0.35;
    cards(-1, t);
    cards(1, t);
    // 品牌字最后画在最前：正中一字带永不被卡片挡住（卡片从上下两侧绕过）
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(PT.p); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(PT.a); gl.vertexAttribPointer(PT.a, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(PT.u.uP, false, Proj); gl.uniform2f(PT.u.uS, tw, tw / txtAspect); gl.uniform1f(PT.u.uCam, cam);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texTxt); gl.uniform1i(PT.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6); gl.disableVertexAttribArray(PT.a);
  }
  function cards(side, t) {
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.useProgram(PC.p); gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf); gl.enableVertexAttribArray(PC.a); gl.vertexAttribPointer(PC.a, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cardIdx);
    var u = PC.u; gl.uniformMatrix4fv(u.uP, false, Proj);
    [['uCam', cam], ['uR', R], ['uW', CARD_W], ['uH', CARD_H], ['uRot', rot], ['uY', yOff], ['uL', L], ['uGap', GAP], ['uPer', PER], ['uMorph', morph],
     ['uBend', bend], ['uT', t], ['uWave', still ? 0 : 1], ['uCount', COUNT], ['uCols', COLS], ['uRows', ROWS], ['uSide', side], ['uClear', clearY]].forEach(function (k) { gl.uniform1f(u[k[0]], k[1]); });
    gl.uniform3fv(u.uBg, ORANGE); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texCard); gl.uniform1i(u.uTex, 0);
    gl.drawElements(gl.TRIANGLES, nIdx, cardIdx.type, 0); gl.disableVertexAttribArray(PC.a);
  }
  var idxEl = document.getElementById('idx'), lastIdx = -1;
  function updIdx() {   // 右上角：当前正对镜头的卡片编号
    var best = -1, bs = -9;
    for (var i = 0; i < nCards; i++) {
      var ring = Math.floor(i / PER), k = i % PER, T = Math.PI * 2;
      var th = (k * T / PER + (ring % 2) * T / PER / 2) * (1 - morph) + (i * T / PER) * morph, y0 = (ring * GAP + GAP * .5) * (1 - morph) + (i * GAP / PER + GAP * .5) * morph;
      var y = ((y0 + yOff + L / 2) % L + L) % L - L / 2, s = Math.cos(th + rot) - Math.abs(y) * .5;
      if (s > bs) { bs = s; best = i % COUNT; }
    }
    if (best !== lastIdx) { lastIdx = best; idxEl.textContent = '产品图 ' + (best + 1 < 10 ? '0' : '') + (best + 1) + ' / ' + COUNT; }
  }
  function kick() { if (!raf && visible && !REC) raf = requestAnimationFrame(frame); }
  function push(v) { if (still) return; vel = Math.max(-7, Math.min(7, vel + v)); kick(); }
  window.__cyl = { kick: kick, push: push, tick: function (ms) { vnow += ms; frame(vnow); }, state: function () { return { vel: vel, bend: bend, morph: morph, rot: rot, yOff: yOff, cam: cam, R: R, asp: asp, cards: nCards }; } };

  // —— 输入：滚动差值 / 顶部上滚滚轮 / 横向拖动 ——
  var lastY = scrollY;
  addEventListener('scroll', function () { var d = scrollY - lastY; lastY = scrollY; if (scrollY < wrap.offsetHeight) push(d * .006); }, { passive: true });
  stage.addEventListener('wheel', function (e) { if (scrollY <= 0 && e.deltaY < 0) push(e.deltaY * .006); }, { passive: true });
  var drag = null;
  stage.addEventListener('pointerdown', function (e) { if (e.target.closest('a,button')) return; drag = { x: e.clientX, t: performance.now() }; });
  addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x; drag.x = e.clientX; push(-dx * .012); });
  addEventListener('pointerup', function () { drag = null; }); addEventListener('pointercancel', function () { drag = null; });
  addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') push(-1.2); if (e.key === 'ArrowRight') push(1.2); });

  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) { last = 0; kick(); } }).observe(wrap);
  addEventListener('resize', function () { resize(); if (still) frame(performance.now()); });
  rm.addEventListener && rm.addEventListener('change', function () { still = rm.matches; last = 0; kick(); });
  cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); root.classList.remove('gl'); noGL('lost'); });

  // 首帧：等字体就绪再画大字和编号，画出后才撤掉静态兜底
  var ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('900 100px "Chenji Sans"', TITLE), document.fonts.load('500 17px "Chenji Sans"', '产品图 0123456789')]) : Promise.resolve();
  Promise.race([ready, new Promise(function (r) { setTimeout(r, 2500); })]).then(function () {
    try {
      paintAtlas(); paintTitle(); resize(); frame(performance.now());
      if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('gl error');
      root.classList.add('gl'); root.dataset.hero = still ? 'webgl-still' : 'webgl';
    } catch (e) { console.warn(e); noGL('init'); }
  });
})();
