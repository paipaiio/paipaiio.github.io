/* ==========================================================
   🌫️ 纸面氛围层 v2
   三层叠加（自下而上）：
   1. 流动暖色渐变网：低分辨率径向渐变画布，CSS 放大产生柔焦
      五团暖色（奶油/鼠尾草/浅金/陶土/米白）各自按双正弦场缓慢漂移，
      随鼠标产生分层视差
   2. 浮尘粒子：稀疏、极慢、低透明度，暖灰 + 琥珀点睛
   3. 纸面颗粒：静态 SVG 噪点（CSS 层）

   克制原则：内部渲染分辨率仅 1/10，粒子上限 64；
   prefers-reduced-motion 时渐变网静态渲染一帧、浮尘关闭；
   页面隐藏时暂停全部动画
========================================================== */
(function () {
    "use strict";

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var meshCanvas = document.getElementById("ambient-mesh");
    var dustCanvas = document.getElementById("ambient-dust");
    if (!dustCanvas) return;

    /* 渐变网画布为可选：标记不存在时跳过渐变网，仅保留浮尘 */
    var mctx = meshCanvas ? meshCanvas.getContext("2d") : null;
    var dctx = dustCanvas.getContext("2d");

    /* 内部渲染分辨率比例：越小越柔、越省性能 */
    var MESH_SCALE = 0.1;
    var vw = 0, vh = 0;          // CSS 像素视口
    var mw = 0, mh = 0;          // 渐变网内部像素
    var running = false;
    var rafId = null;
    var t0 = performance.now();

    /* ---------- 主题 ---------- */
    function isDark() {
        return document.documentElement.getAttribute("data-theme") === "dark";
    }

    var themeBg = "";
    function refreshThemeBg() {
        themeBg = getComputedStyle(document.documentElement)
            .getPropertyValue("--theme").trim() || (isDark() ? "#141413" : "#faf9f5");
    }

    /* ---------- 流动渐变网 ---------- */
    /* 每团：基准位置 / 半径 / 双正弦漂移参数 / 视差深度；
       色值为 [亮色, 暗色] 两组，取自全站暖石色系 */
    var blobs = [
        { bx: 0.16, by: 0.10, r: 0.60, cL: [233, 215, 188], cD: [ 96,  76,  48], a: 0.90, sp1: 0.000021, sp2: 0.000013, ax: 0.10, ay: 0.09, ph: 0.0, depth: 14 },
        { bx: 0.86, by: 0.88, r: 0.66, cL: [214, 222, 206], cD: [ 58,  66,  54], a: 0.85, sp1: 0.000017, sp2: 0.000023, ax: 0.09, ay: 0.12, ph: 2.1, depth: 22 },
        { bx: 0.78, by: 0.12, r: 0.46, cL: [240, 224, 199], cD: [ 82,  64,  50], a: 0.75, sp1: 0.000025, sp2: 0.000015, ax: 0.12, ay: 0.07, ph: 4.2, depth: 30 },
        { bx: 0.12, by: 0.90, r: 0.50, cL: [232, 205, 190], cD: [ 74,  56,  46], a: 0.70, sp1: 0.000019, sp2: 0.000027, ax: 0.08, ay: 0.10, ph: 1.3, depth: 18 },
        { bx: 0.52, by: 0.48, r: 0.55, cL: [244, 232, 214], cD: [ 68,  58,  46], a: 0.50, sp1: 0.000012, sp2: 0.000019, ax: 0.14, ay: 0.13, ph: 3.4, depth: 40 }
    ];

    /* 鼠标视差：目标值 → 缓动跟随 */
    var parX = 0, parY = 0, parTX = 0, parTY = 0;
    window.addEventListener("pointermove", function (e) {
        parTX = e.clientX / Math.max(vw, 1) - 0.5;
        parTY = e.clientY / Math.max(vh, 1) - 0.5;
    }, { passive: true });

    function drawMesh(now) {
        if (!mctx) return;
        var t = now - t0;
        var dark = isDark();
        var alphaEnv = dark ? 0.38 : 1;   // 暗色下收敛，避免发闷

        mctx.fillStyle = themeBg;
        mctx.fillRect(0, 0, mw, mh);

        parX += (parTX - parX) * 0.03;
        parY += (parTY - parY) * 0.03;

        var maxDim = Math.max(vw, vh);
        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];
            var driftX = Math.sin(t * b.sp1 + b.ph) * b.ax
                       + Math.sin(t * b.sp2 + b.ph * 1.7) * b.ax * 0.6;
            var driftY = Math.cos(t * b.sp1 * 0.9 + b.ph * 1.3) * b.ay
                       + Math.cos(t * b.sp2 * 1.1 + b.ph) * b.ay * 0.6;

            var cx = (b.bx + driftX) * vw + parX * b.depth;
            var cy = (b.by + driftY) * vh + parY * b.depth;
            var rr = b.r * maxDim * (1 + 0.07 * Math.sin(t * 0.000018 + b.ph * 2));

            var c = dark ? b.cD : b.cL;
            var a = b.a * alphaEnv;
            var x = cx * MESH_SCALE, y = cy * MESH_SCALE, r = Math.max(rr * MESH_SCALE, 1);

            var g = mctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")");
            g.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
            mctx.fillStyle = g;
            mctx.fillRect(0, 0, mw, mh);
        }
    }

    /* ---------- 浮尘粒子 ---------- */
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var particles = [];
    var dustLast = performance.now();

    /* 暖色系粒子：82% 中性暖灰/暖白，18% 琥珀色点睛 */
    function dustPalette() {
        return isDark()
            ? [[250, 249, 245], [214, 183, 140]]
            : [[120, 113, 108], [176, 142, 92]];
    }

    function dustSpawn(p) {
        var colors = dustPalette();
        p.amber = Math.random() < 0.18;
        p.color = colors[p.amber ? 1 : 0];
        p.x = Math.random() * vw;
        p.y = Math.random() * vh;
        p.r = 0.8 + Math.random() * 1.8;            // 半径 0.8–2.6px
        p.vx = (Math.random() - 0.5) * 0.14;        // 缓慢水平漂移
        p.vy = (Math.random() - 0.5) * 0.10 - 0.02; // 微微向上浮
        p.phase = Math.random() * Math.PI * 2;      // 正弦摆动相位
        p.life = 0;
        p.ttl = 9000 + Math.random() * 14000;       // 生命周期 9–23s
        p.maxA = 0.05 + Math.random() * 0.13;       // 峰值透明度 0.05–0.18
        return p;
    }

    function dustSeed() {
        var n = Math.min(64, Math.floor((vw * vh) / 26000));
        particles = [];
        for (var i = 0; i < n; i++) {
            var p = dustSpawn({});
            p.life = Math.random() * p.ttl;         // 初始相位错开
            particles.push(p);
        }
    }

    function drawDust(now) {
        var dt = Math.min(now - dustLast, 50);
        dustLast = now;
        var step = dt / 16.7; // 以 60fps 为基准归一化

        dctx.clearRect(0, 0, vw, vh);

        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            p.life += dt;
            if (p.life > p.ttl) dustSpawn(p);

            var t = p.life / p.ttl;
            var a = p.maxA * Math.sin(Math.PI * t); // 正弦淡入淡出
            p.phase += dt * 0.0004;
            p.x += p.vx * step + Math.sin(p.phase) * 0.18;
            p.y += p.vy * step;

            // 出界回绕
            if (p.x < -8) p.x = vw + 8;
            if (p.x > vw + 8) p.x = -8;
            if (p.y < -8) p.y = vh + 8;
            if (p.y > vh + 8) p.y = -8;

            var c = p.color;
            // 外层柔光晕
            dctx.beginPath();
            dctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
            dctx.fillStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a * 0.28) + ")";
            dctx.fill();
            // 内核
            dctx.beginPath();
            dctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            dctx.fillStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
            dctx.fill();
        }
    }

    /* ---------- 尺寸 ---------- */
    function resize() {
        vw = window.innerWidth;
        vh = window.innerHeight;

        mw = Math.max(1, Math.floor(vw * MESH_SCALE));
        mh = Math.max(1, Math.floor(vh * MESH_SCALE));
        if (meshCanvas) {
            meshCanvas.width = mw;
            meshCanvas.height = mh;
        }

        dustCanvas.width = Math.floor(vw * dpr);
        dustCanvas.height = Math.floor(vh * dpr);
        dctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        dustSeed();
    }

    /* ---------- 主循环 ---------- */
    function tick(now) {
        if (!running) return;
        drawMesh(now);
        drawDust(now);
        rafId = requestAnimationFrame(tick);
    }

    function start() {
        if (running) return;
        running = true;
        dustLast = performance.now();
        rafId = requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    }

    /* ---------- 主题切换：换底色与粒子色，渐变网就地换色 ---------- */
    new MutationObserver(function () {
        refreshThemeBg();
        var colors = dustPalette();
        for (var i = 0; i < particles.length; i++) {
            particles[i].color = colors[particles[i].amber ? 1 : 0];
        }
        if (reduceMotion) drawMesh(performance.now()); // 静态模式补一帧
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
    });

    document.addEventListener("visibilitychange", function () {
        if (reduceMotion) return; // 静态模式无所谓暂停
        if (document.hidden) stop();
        else start();
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            resize();
            if (reduceMotion) drawMesh(performance.now());
        }, 150);
    });

    /* ---------- 启动 ---------- */
    refreshThemeBg();
    resize();

    if (reduceMotion) {
        drawMesh(performance.now());  // 静态渲染一帧：有质感、无运动
    } else {
        start();
    }
})();
