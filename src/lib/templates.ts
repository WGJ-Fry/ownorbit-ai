// Interactive Sandboxed Boilerplate Templates for OwnOrbit Custom Apps

export const TEMPLATES = {
  todo: `<!-- Smart Task Board (Alpine.js Task Tracker) -->
<div class="p-6 bg-[#0c0c0e] min-h-screen text-zinc-100 flex flex-col justify-between" x-data="{
  newTodo: '',
  todos: Alpine.$persist([
    { id: 1, text: 'Sync morning habit library', done: true },
    { id: 2, text: 'Check model API latency', done: false },
    { id: 3, text: 'Integrate custom micro app', done: false }
  ]).as('todos_v1'),
  addTodo() {
    if (!this.newTodo.trim()) return;
    this.todos.push({ id: Date.now(), text: this.newTodo, done: false });
    this.newTodo = '';
  },
  toggleTodo(id) {
    let todo = this.todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  },
  deleteTodo(id) {
    this.todos = this.todos.filter(t => t.id !== id);
  },
  get completionRate() {
    if (this.todos.length === 0) return 0;
    return Math.round((this.todos.filter(t => t.done).length / this.todos.length) * 100);
  }
}">
  <div>
    <!-- Header -->
    <div class="flex justify-between items-center mb-6">
      <div>
        <h3 class="text-base font-bold text-white tracking-tight flex items-center gap-2">
          🎯 Smart Task Board
        </h3>
        <p class="text-[10px] text-zinc-400 mt-1">LocalPersist-powered independent cache layer</p>
      </div>
      <div class="px-2.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-mono font-bold" x-text="completionRate + '%'"></div>
    </div>

    <!-- Stats Bar -->
    <div class="w-full h-1 bg-zinc-800 rounded-full mb-5 overflow-hidden">
      <div class="h-full bg-indigo-500 transition-all duration-500" :style="'width: ' + completionRate + '%'"></div>
    </div>

    <!-- Form -->
    <form @submit.prevent="addTodo" class="flex gap-2 mb-5">
      <input type="text" x-model="newTodo" placeholder="Type a memo and press Enter..." class="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500/50 transition-colors">
      <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3 rounded-xl transition-all">Add</button>
    </form>

    <!-- List -->
    <div class="space-y-1.5">
      <template x-for="todo in todos" :key="todo.id">
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/60 transition-colors">
          <div class="flex items-center gap-2.5">
            <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo.id)" class="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-0 cursor-pointer">
            <span :class="todo.done ? 'line-through text-zinc-500 text-xs' : 'text-zinc-200 text-xs font-semibold'" x-text="todo.text font-medium"></span>
          </div>
          <button @click="deleteTodo(todo.id)" class="text-zinc-500 hover:text-red-400 text-[10px] font-mono">Delete</button>
        </div>
      </template>
    </div>
  </div>

  <div class="text-[9px] text-zinc-600 text-center font-mono mt-4 pt-3 border-t border-zinc-900">
    OwnOrbit Sanboxed Terminal Standard Spec Container
  </div>
</div>`,

  chart: `<!-- Network Status and Latency Probe (Chart.js Line Chart) -->
<div class="p-6 bg-[#0a0a0c] min-h-screen text-zinc-100 flex flex-col justify-between" x-data="{
  packetCount: 0,
  latencyRecords: [24, 28, 35, 45, 22, 29, 31],
  initChart() {
    const ctx = document.getElementById('probeChart').getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['1s', '2s', '3s', '4s', '5s', '6s', '7s'],
        datasets: [{
          label: 'Physical relay latency (ms)',
          data: this.latencyRecords,
          borderColor: '#6366f1',
          borderWidth: 2,
          backgroundColor: 'rgba(99, 102, 241, 0.05)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#71717a', font: { size: 9 } } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#71717a', font: { size: 9 } } }
        }
      }
    });

    // Simulate real-time polling
    setInterval(() => {
      const newVal = Math.floor(Math.random() * 25) + 18;
      this.latencyRecords.push(newVal);
      if(this.latencyRecords.length > 7) this.latencyRecords.shift();
      this.chart.data.datasets[0].data = this.latencyRecords;
      this.chart.update();
      this.packetCount += 1;
    }, 2000);
  }
}" x-init="initChart()">
  <div>
    <div class="flex justify-between items-center mb-4">
      <div>
        <h3 class="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
          ⚡ Smart Routing Status
        </h3>
        <p class="text-[10px] text-zinc-400 mt-1">Chart card powered by external Chart.js CDN</p>
      </div>
      <span class="text-[9px] bg-emerald-500/10 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/20">
        Pings: <span x-text="packetCount"></span>
      </span>
    </div>

    <div class="w-full bg-[#111113] p-3 rounded-2xl border border-zinc-800">
      <canvas id="probeChart" class="w-full h-36"></canvas>
    </div>
  </div>

  <div class="text-[9.5px] text-zinc-500 text-left leading-relaxed mt-4 font-sans bg-zinc-900/40 p-3 rounded-xl border border-zinc-800/30">
    💡 This template shows how to draw advanced dashboard cards elegantly with third-party JS libraries such as Chart.js or D3.
  </div>
</div>`,

  clock: `<!-- Cosmic Starfall Particle Clock (Canvas Starfall Clock) -->
<div class="p-6 bg-[#0c0c0e] min-h-screen text-zinc-100 flex flex-col justify-between" x-data="{
  currentTime: '',
  is24Hour: true,
  updateClock() {
    const t = new Date();
    if (this.is24Hour) {
      this.currentTime = t.toTimeString().split(' ')[0];
    } else {
      let hrs = t.getHours();
      const ampm = hrs >= 12 ? 'PM' : 'AM';
      hrs = hrs % 12 || 12;
      const mins = String(t.getMinutes()).padStart(2, '0');
      const secs = String(t.getSeconds()).padStart(2, '0');
      this.currentTime = hrs + ':' + mins + ':' + secs + ' ' + ampm;
    }
  },
  initStars() {
    const canvas = document.getElementById('starCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 120;

    let particles = [];
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.5,
        v: Math.random() * 0.3 + 0.1
      });
    }

    const anim = () => {
      if(!document.getElementById('starCanvas')) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        p.y += p.v;
        if(p.y > canvas.height) {
          p.y = 0;
          p.x = Math.random() * canvas.width;
        }
      });
      requestAnimationFrame(anim);
    };
    anim();
  }
}" x-init="setInterval(() => updateClock(), 1000); updateClock(); setTimeout(() => initStars(), 100);">
  <div>
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-xs font-bold uppercase tracking-widest text-[#6366f1] text-left">
        🌌 Particle Time Card
      </h3>
      <button @click="is24Hour = !is24Hour" class="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[9px] font-bold px-2 py-0.5 rounded-lg hover:border-zinc-700 active:scale-95 transition-all text-center" x-text="is24Hour ? '12H' : '24H'"></button>
    </div>

    <!-- Glowing Cyber Clock -->
    <div class="relative py-4 rounded-3xl border border-indigo-500/20 overflow-hidden flex items-center justify-center bg-indigo-950/10 mb-4 h-32">
      <canvas id="starCanvas" class="absolute inset-0 pointer-events-none opacity-40"></canvas>
      <div class="relative z-10 text-center">
        <h1 class="text-2xl font-extrabold text-indigo-100 font-mono tracking-wider" x-text="currentTime"></h1>
        <p class="text-[9px] tracking-widest text-zinc-500 uppercase mt-1 font-mono">Stellar Pulsing System Time</p>
      </div>
    </div>
  </div>

  <div class="text-[9px] text-zinc-600 font-mono text-center">
    Terminal Standalone Time Engine Enabled
  </div>
</div>`
};
