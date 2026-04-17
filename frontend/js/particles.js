// Фон: сеть частиц и линии (адаптировано с проекта Levochkina)
(function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var particles = [];
    var mouse = { x: -1000, y: -1000 };
    var PARTICLE_COUNT = 150;
    var CONNECTION_DIST = 160;
    var MOUSE_RADIUS = 220;
    /* Тёмные, но читаемые на фоне #111214 */
    var LINE_RGB = '108,114,126';
    var PALETTE = ['92,98,110', '118,124,136', '100,106,118'];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    document.addEventListener('mousemove', function (e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });
    document.addEventListener('mouseleave', function () {
        mouse.x = -1000;
        mouse.y = -1000;
    });

    function Particle() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.6;
        this.vy = (Math.random() - 0.5) * 0.6;
        this.radius = Math.random() * 1.6 + 0.55;
        this.baseAlpha = Math.random() * 0.28 + 0.14;
        this.alpha = this.baseAlpha;
        this.color = PALETTE[(Math.random() * PALETTE.length) | 0];
        this.targetVx = this.vx;
        this.targetVy = this.vy;
        this.changeTimer = Math.random() * 200;
    }

    Particle.prototype.update = function () {
        this.changeTimer--;
        if (this.changeTimer <= 0) {
            this.targetVx = (Math.random() - 0.5) * 0.6;
            this.targetVy = (Math.random() - 0.5) * 0.6;
            this.changeTimer = 150 + Math.random() * 250;
        }
        this.vx += (this.targetVx - this.vx) * 0.005;
        this.vy += (this.targetVy - this.vy) * 0.005;
        var dx = mouse.x - this.x;
        var dy = mouse.y - this.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
            var force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
            var angle = Math.atan2(dy, dx);
            this.vx -= Math.cos(angle) * force * 0.04;
            this.vy -= Math.sin(angle) * force * 0.04;
            this.alpha = Math.min(0.72, this.baseAlpha + force * 0.38);
        } else {
            this.alpha += (this.baseAlpha - this.alpha) * 0.03;
        }
        this.vx *= 0.998;
        this.vy *= 0.998;
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < -50) this.x = canvas.width + 50;
        if (this.x > canvas.width + 50) this.x = -50;
        if (this.y < -50) this.y = canvas.height + 50;
        if (this.y > canvas.height + 50) this.y = -50;
    };

    Particle.prototype.draw = function () {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + this.color + ',' + this.alpha + ')';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + this.color + ',' + (this.alpha * 0.32) + ')';
        ctx.fill();
    };

    for (var i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new Particle());
    }

    function drawConnections() {
        for (var i = 0; i < particles.length; i++) {
            for (var j = i + 1; j < particles.length; j++) {
                var dx = particles[i].x - particles[j].x;
                var dy = particles[i].y - particles[j].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECTION_DIST) {
                    var alpha = (1 - dist / CONNECTION_DIST) * 0.12;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = 'rgba(' + LINE_RGB + ',' + alpha + ')';
                    ctx.lineWidth = 0.75;
                    ctx.stroke();
                }
            }
            var mdx = mouse.x - particles[i].x;
            var mdy = mouse.y - particles[i].y;
            var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
            if (mDist < MOUSE_RADIUS) {
                var mAlpha = (1 - mDist / MOUSE_RADIUS) * 0.22;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(mouse.x, mouse.y);
                ctx.strokeStyle = 'rgba(' + LINE_RGB + ',' + mAlpha + ')';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (var i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }
        drawConnections();
        requestAnimationFrame(animate);
    }
    animate();
})();
