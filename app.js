(() => {
  'use strict';

  const CORS_PROXY    = 'https://corsproxy.io/?';
  const DEEZER_BASE   = 'https://api.deezer.com';
  const DEFAULT_QUERY = 'lofi';
  const MAX_TRACKS    = 20;
  const TOP_N         = 5;

  let playlist     = [];
  let currentIndex = 0;
  let isPlaying    = false;
  let isShuffle    = false;
  let repeatMode   = 'none';
  let isMuted      = false;
  let likedIds     = new Set(JSON.parse(localStorage.getItem('vt-liked') || '[]'));

  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';

  const $ = id => document.getElementById(id);

  const albumArt           = $('album-art');
  const songTitle          = $('song-title');
  const artistName         = $('artist-name');
  const albumName          = $('album-name');
  const progressBar        = $('progress-bar');
  const currentTimeEl      = $('current-time');
  const totalTimeEl        = $('total-time');
  const playPauseBtn       = $('play-pause-btn');
  const prevBtn            = $('prev-btn');
  const nextBtn            = $('next-btn');
  const shuffleBtn         = $('shuffle-btn');
  const repeatBtn          = $('repeat-btn');
  const muteBtn            = $('mute-btn');
  const volumeBar          = $('volume-bar');
  const likeBtn            = $('like-btn');
  const searchInput        = $('search-input');
  const searchForm         = $('search-form');
  const topTracksContainer = $('top-tracks-container');
  const queueList          = $('queue-list');
  const statusBar          = $('status-bar');
  const equalizer          = $('equalizer');
  const toast              = $('toast');
  const shortcutsModal     = $('shortcuts-modal');
  const shortcutsBtn       = $('shortcuts-btn');
  const shortcutsClose     = $('shortcuts-close');

  /* --- Utilities --- */
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }

  function setStatus(msg, loading = false) {
    statusBar.innerHTML = loading ? `<span class="spinner"></span>${msg}` : msg;
  }

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function saveLiked() {
    localStorage.setItem('vt-liked', JSON.stringify([...likedIds]));
  }

  /* --- Deezer API --- */
  async function fetchTracks(query) {
    const endpoint = `${DEEZER_BASE}/search?q=${encodeURIComponent(query)}&limit=${MAX_TRACKS}`;
    const url = `${CORS_PROXY}${encodeURIComponent(endpoint)}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data?.length) throw new Error('No tracks found');
    return json.data.map(t => ({
      id:      t.id,
      title:   t.title,
      artist:  t.artist.name,
      album:   t.album.title,
      preview: t.preview,
      cover:   t.album.cover_medium || t.album.cover,
    }));
  }

  /* --- Player --- */
  function loadTrack(index, autoPlay = true) {
    if (!playlist.length) return;
    currentIndex = ((index % playlist.length) + playlist.length) % playlist.length;
    const track = playlist[currentIndex];

    songTitle.textContent  = track.title;
    artistName.textContent = track.artist;
    albumName.textContent  = track.album;
    albumArt.src           = track.cover;
    albumArt.alt           = `${track.title} by ${track.artist}`;

    updateLikeBtn(track.id);
    progressBar.value = 0;
    progressBar.style.background = '';
    currentTimeEl.textContent = '0:00';
    totalTimeEl.textContent   = '0:00';

    audio.src = track.preview;
    audio.load();

    if (autoPlay) {
      audio.play()
        .then(() => setIsPlaying(true))
        .catch(() => { setStatus('Click Play to start.'); setIsPlaying(false); });
    } else {
      setIsPlaying(false);
    }

    highlightActive();
    renderQueue();
  }

  function togglePlay() {
    if (!playlist.length) return;
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function setIsPlaying(playing) {
    isPlaying = playing;
    playPauseBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
    playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    albumArt.classList.toggle('playing', playing);
    equalizer.classList.toggle('hidden', !playing);
  }

  function nextTrack(userInitiated = false) {
    if (repeatMode === 'one' && !userInitiated) {
      audio.currentTime = 0;
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }
    const next = isShuffle
      ? Math.floor(Math.random() * playlist.length)
      : currentIndex + 1;
    if (next >= playlist.length && repeatMode === 'none' && !userInitiated) {
      setIsPlaying(false); return;
    }
    loadTrack(next, true);
  }

  /* --- Progress --- */
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressBar.value = pct;
    progressBar.style.background =
      `linear-gradient(to right, var(--neon-blue) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
    currentTimeEl.textContent = fmt(audio.currentTime);
    totalTimeEl.textContent   = fmt(audio.duration);
  });

  progressBar.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration;
  });

  audio.addEventListener('ended',   () => nextTrack(false));
  audio.addEventListener('waiting', () => setStatus('Buffering…', true));
  audio.addEventListener('playing', () => setStatus(''));
  audio.addEventListener('error',   () => {
    setStatus('Could not load audio — skipping…');
    setTimeout(() => nextTrack(false), 1500);
  });

  /* --- Volume --- */
  volumeBar.addEventListener('input', () => {
    audio.volume = parseFloat(volumeBar.value);
    isMuted = audio.volume === 0;
    muteBtn.innerHTML = isMuted ? '&#128263;' : '&#128266;';
    volumeBar.style.background =
      `linear-gradient(to right, var(--neon-blue) ${volumeBar.value * 100}%, rgba(255,255,255,0.12) ${volumeBar.value * 100}%)`;
  });

  function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    muteBtn.innerHTML = isMuted ? '&#128263;' : '&#128266;';
    showToast(isMuted ? 'Muted' : 'Unmuted');
  }
  muteBtn.addEventListener('click', toggleMute);

  /* --- Shuffle & Repeat --- */
  function toggleShuffle() {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
    showToast(isShuffle ? 'Shuffle on' : 'Shuffle off');
  }

  function cycleRepeat() {
    const modes  = ['none', 'all', 'one'];
    repeatMode   = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    const labels = { none: '&#8635;', all: '&#8635; All', one: '&#8635; 1' };
    repeatBtn.innerHTML = labels[repeatMode];
    repeatBtn.classList.toggle('active', repeatMode !== 'none');
    showToast({ none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[repeatMode]);
  }

  shuffleBtn.addEventListener('click', toggleShuffle);
  repeatBtn.addEventListener('click', cycleRepeat);

  /* --- Like --- */
  function updateLikeBtn(id) {
    const liked = likedIds.has(String(id));
    likeBtn.innerHTML = liked ? '&#9829;' : '&#9825;';
    likeBtn.classList.toggle('liked', liked);
    likeBtn.setAttribute('aria-label', liked ? 'Unlike track' : 'Like track');
  }

  function toggleLike() {
    if (!playlist.length) return;
    const id = String(playlist[currentIndex].id);
    if (likedIds.has(id)) { likedIds.delete(id); showToast('Removed from liked songs'); }
    else                  { likedIds.add(id);    showToast('Added to liked songs ❤️'); }
    saveLiked();
    updateLikeBtn(id);
  }
  likeBtn.addEventListener('click', toggleLike);

  /* --- Highlight active --- */
  function highlightActive() {
    topTracksContainer.querySelectorAll('.track-card').forEach((card, i) => {
      card.classList.toggle('active', i === currentIndex && currentIndex < TOP_N);
    });
    queueList.querySelectorAll('.queue-item').forEach((item, i) => {
      item.classList.toggle('active', i === currentIndex);
      if (i === currentIndex) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  /* --- Render top tracks --- */
  function renderTopTracks() {
    topTracksContainer.innerHTML = '';
    playlist.slice(0, TOP_N).forEach((track, i) => {
      const card = document.createElement('div');
      card.className = 'track-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${track.title} by ${track.artist}`);
      card.innerHTML = `
        <img src="${track.cover}" alt="" loading="lazy" />
        <p class="track-card-title">${track.title}</p>
        <p class="track-card-artist">${track.artist}</p>
      `;
      const play = () => loadTrack(i, true);
      card.addEventListener('click', play);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
      topTracksContainer.appendChild(card);
    });
  }

  /* --- Render queue --- */
  function renderQueue() {
    queueList.innerHTML = '';
    playlist.forEach((track, i) => {
      const li = document.createElement('li');
      li.className = 'queue-item' + (i === currentIndex ? ' active' : '');
      li.setAttribute('role', 'listitem');
      li.setAttribute('tabindex', '0');
      li.innerHTML = `
        <img src="${track.cover}" alt="" loading="lazy" />
        <div class="queue-item-info">
          <p class="queue-item-title">${track.title}</p>
          <p class="queue-item-artist">${track.artist}</p>
        </div>
        <span class="queue-item-num">${i === currentIndex ? '&#9654;' : i + 1}</span>
      `;
      const play = () => loadTrack(i, true);
      li.addEventListener('click', play);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
      queueList.appendChild(li);
    });
  }

  /* --- Search --- */
  async function search(query) {
    if (!query.trim()) return;
    setStatus(`Searching for "${query}"…`, true);
    try {
      playlist     = await fetchTracks(query);
      currentIndex = 0;
      renderTopTracks();
      renderQueue();
      loadTrack(0, true);
      setStatus('');
    } catch (err) {
      setStatus(`⚠️ ${err.message}`);
    }
  }

  /* --- Events --- */
  searchForm.addEventListener('submit', e => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) search(q);
  });

  playPauseBtn.addEventListener('click', togglePlay);
  nextBtn.addEventListener('click', () => nextTrack(true));
  prevBtn.addEventListener('click', () => loadTrack(currentIndex - 1, true));

  shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.remove('hidden'));
  shortcutsClose.addEventListener('click', () => shortcutsModal.classList.add('hidden'));
  shortcutsModal.addEventListener('click', e => { if (e.target === shortcutsModal) shortcutsModal.classList.add('hidden'); });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    switch (e.key) {
      case ' ':           e.preventDefault(); togglePlay();                       break;
      case 'ArrowRight':  e.preventDefault(); nextTrack(true);                   break;
      case 'ArrowLeft':   e.preventDefault(); loadTrack(currentIndex - 1, true); break;
      case 'l': case 'L': toggleLike();                                           break;
      case 's': case 'S': toggleShuffle();                                        break;
      case 'r': case 'R': cycleRepeat();                                          break;
      case 'm': case 'M': toggleMute();                                           break;
      case '?':           shortcutsModal.classList.remove('hidden');              break;
      case 'Escape':      shortcutsModal.classList.add('hidden');                 break;
    }
  });

  /* --- Init --- */
  search(DEFAULT_QUERY);

})();
