/* ===================================================================
   Hotel Finder — app.js
   Vanilla JS, no framework. Talks to /api/hotels and friends.
   =================================================================== */

(function () {
  'use strict';

  // ── State ──
  let currentHotels = [];
  let currentCompare = [];
  let currentSort = 'price-asc';
  let currentCity = '';
  let sliderMin = 0;
  let sliderMax = 10000;
  let debounceTimer = null;
  let isLoading = false;

  // ── DOM refs ──
  const cityInput = document.getElementById('city-input');
  const findBtn = document.getElementById('find-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const sliderMinEl = document.getElementById('slider-min');
  const sliderMaxEl = document.getElementById('slider-max');
  const sliderFill = document.getElementById('slider-fill');
  const minPriceInput = document.getElementById('min-price-input');
  const maxPriceInput = document.getElementById('max-price-input');
  const rangeDisplay = document.getElementById('range-display');
  const resultsContainer = document.getElementById('results-container');
  const sortControls = document.getElementById('sort-controls');
  const priceFilter = document.getElementById('price-filter');
  const resultsCount = document.getElementById('results-count');
  const partialBanner = document.getElementById('partial-banner');
  const partialBannerText = document.getElementById('partial-banner-text');
  const bannerClose = document.getElementById('banner-close');
  const cacheInfo = document.getElementById('cache-info');

  // ── Formatting helpers ──
  function formatPrice(n) {
    return new Intl.NumberFormat('en-IN').format(n);
  }

  function timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 10) return 'refreshed just now';
    if (secs < 60) return 'refreshed ' + secs + 's ago';
    var mins = Math.floor(secs / 60);
    return 'cached ' + mins + ' min ago';
  }

  // ── API calls ──
  async function fetchHotels(city, minPrice, maxPrice, refresh) {
    if (isLoading) return;
    isLoading = true;
    findBtn.disabled = true;
    showSkeleton();
    hideBanner();

    var url = '/api/hotels?city=' + encodeURIComponent(city);
    if (minPrice !== undefined && minPrice !== null) url += '&minPrice=' + minPrice;
    if (maxPrice !== undefined && maxPrice !== null) url += '&maxPrice=' + maxPrice;
    if (refresh) url += '&refresh=true';

    try {
      var resp = await fetch(url);
      var data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Request failed with status ' + resp.status);
      }

      currentHotels = data;
      currentCity = city;

      // Check partial result headers
      var partial = resp.headers.get('X-Partial-Result');
      var failedSuppliers = resp.headers.get('X-Failed-Suppliers');
      var cachedAt = resp.headers.get('X-Cached-At');

      if (partial === 'true' && failedSuppliers) {
        var names = failedSuppliers.split(',').map(function (s) {
          return s.trim() === 'supplierA' ? 'Supplier A' : 'Supplier B';
        });
        showBanner("Heads up: " + names.join(' and ') + " didn't answer, so these are partial prices only.");
      }

      if (cachedAt) {
        cacheInfo.textContent = timeAgo(cachedAt);
        cacheInfo.hidden = false;
      } else {
        cacheInfo.hidden = true;
      }

      // On first load (no price filter set), set slider range from data
      if (minPrice === undefined && maxPrice === undefined && data.length > 0) {
        var prices = data.map(function (h) { return h.price; });
        var dataMin = Math.min.apply(null, prices);
        var dataMax = Math.max.apply(null, prices);
        initSlider(dataMin, dataMax);
      }

      // Fetch compare data for annotations
      fetchCompare(city);

      renderHotels(getSortedHotels(currentHotels, currentSort));

      if (data.length > 0) {
        priceFilter.hidden = false;
        sortControls.hidden = false;
      } else {
        priceFilter.hidden = true;
        sortControls.hidden = true;
      }
    } catch (err) {
      showError(err.message, function () {
        fetchHotels(city, minPrice, maxPrice, refresh);
      });
    } finally {
      isLoading = false;
      findBtn.disabled = false;
    }
  }

  async function fetchCompare(city) {
    try {
      var resp = await fetch('/api/hotels/compare?city=' + encodeURIComponent(city));
      if (resp.ok) {
        currentCompare = await resp.json();
        // Re-render to show annotations
        renderHotels(getSortedHotels(currentHotels, currentSort));
      }
    } catch (e) {
      // Compare is optional; silently fail
      currentCompare = [];
    }
  }

  // ── Render hotels ──
  function renderHotels(hotels) {
    if (hotels.length === 0) {
      showEmpty(currentCity);
      resultsCount.textContent = '';
      return;
    }

    resultsCount.textContent = hotels.length + ' hotel' + (hotels.length === 1 ? '' : 's');

    var cheapestPrice = Math.min.apply(null, hotels.map(function (h) { return h.price; }));

    var html = '<ul class="hotel-list" role="list">';
    hotels.forEach(function (hotel, idx) {
      var isCheapest = hotel.price === cheapestPrice && idx === 0;
      var supplierClass = hotel.supplier === 'Supplier A' ? 'supplier-a' : 'supplier-b';

      // Build annotation from compare data
      var annotation = '';
      if (currentCompare.length > 0) {
        var normalizedName = hotel.name.trim().toLowerCase().replace(/\s+/g, ' ');
        var cmp = currentCompare.find(function (c) {
          return c.normalizedName === normalizedName;
        });
        if (cmp && cmp.supplierA && cmp.supplierB) {
          var otherPrice;
          var otherName;
          if (hotel.supplier === 'Supplier A' && cmp.supplierB) {
            otherPrice = cmp.supplierB.price;
            otherName = 'Supplier B';
          } else if (hotel.supplier === 'Supplier B' && cmp.supplierA) {
            otherPrice = cmp.supplierA.price;
            otherName = 'Supplier A';
          }
          if (otherPrice && otherPrice > hotel.price) {
            var savings = otherPrice - hotel.price;
            annotation = '<span class="annotation">beat ' + otherName + ' by ₹' + formatPrice(savings) + '</span>';
          }
        }
      }

      html += '<li class="hotel-row">';
      if (isCheapest) {
        html += '<span class="best-stamp">best<br>find</span>';
      }
      html += '<div class="hotel-info">';
      html += '<div class="hotel-name">' + escapeHtml(hotel.name) + '</div>';
      html += '<div class="hotel-meta">';
      html += '<span class="supplier-tag ' + supplierClass + '">' + escapeHtml(hotel.supplier) + '</span>';
      html += '<span class="commission">' + hotel.commissionPct + '% commission</span>';
      if (annotation) html += annotation;
      html += '</div>';
      html += '</div>';
      html += '<div class="hotel-price"><span class="price-currency">₹</span>' + formatPrice(hotel.price) + '</div>';
      html += '</li>';
    });
    html += '</ul>';

    resultsContainer.innerHTML = html;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ── UI states ──
  function showSkeleton() {
    var html = '';
    for (var i = 0; i < 5; i++) {
      var w1 = [60, 55, 65, 50, 58][i];
      var w2 = [40, 35, 30, 38, 42][i];
      html += '<div class="skeleton-row">';
      html += '<div class="skeleton-line w' + (w1 > 55 ? '60' : '40') + '"></div>';
      html += '<div class="skeleton-line w' + (w2 > 35 ? '40' : '30') + '"></div>';
      html += '</div>';
    }
    resultsContainer.innerHTML = html;
  }

  function showEmpty(city) {
    var knownCities = ['delhi', 'mumbai', 'bengaluru'];
    var isKnown = knownCities.indexOf((city || '').toLowerCase()) !== -1;

    var html = '<div class="empty-state">';
    html += '<svg class="empty-illustration" width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
    html += '<rect x="20" y="50" width="80" height="45" rx="6" stroke="#C4552D" stroke-width="2" fill="none"/>';
    html += '<path d="M30 70 Q60 55 90 70" stroke="#E4D8C3" stroke-width="1.5" fill="none"/>';
    html += '<circle cx="60" cy="80" r="4" fill="#D9A441"/>';
    html += '<text x="60" y="40" text-anchor="middle" font-size="28" fill="#C4552D">?</text>';
    html += '</svg>';

    if (isKnown) {
      html += '<p class="empty-title">No hotels match that price range</p>';
      html += '<p class="empty-sub">Try widening the range or resetting the filter.</p>';
    } else {
      html += '<p class="empty-title">Nothing listed for "' + escapeHtml(city) + '" yet</p>';
      html += '<p class="empty-sub">Try Delhi, Mumbai or Bengaluru — that\'s where our data lives for now.</p>';
    }
    html += '</div>';
    resultsContainer.innerHTML = html;
  }

  function showError(msg, retryFn) {
    var html = '<div class="error-state">';
    html += '<p>' + escapeHtml(msg) + '</p>';
    html += '<button class="retry-btn" id="retry-btn">Try again</button>';
    html += '</div>';
    resultsContainer.innerHTML = html;
    document.getElementById('retry-btn').addEventListener('click', retryFn);
  }

  // ── Sorting ──
  function getSortedHotels(hotels, sort) {
    var arr = hotels.slice();
    switch (sort) {
      case 'price-asc':
        arr.sort(function (a, b) { return a.price - b.price; });
        break;
      case 'price-desc':
        arr.sort(function (a, b) { return b.price - a.price; });
        break;
      case 'name':
        arr.sort(function (a, b) { return a.name.localeCompare(b.name); });
        break;
    }
    return arr;
  }

  // ── Slider ──
  function initSlider(min, max) {
    // Round to nice 100s
    sliderMin = Math.floor(min / 100) * 100;
    sliderMax = Math.ceil(max / 100) * 100;
    if (sliderMin === sliderMax) sliderMax = sliderMin + 1000;

    sliderMinEl.min = sliderMin;
    sliderMinEl.max = sliderMax;
    sliderMinEl.value = sliderMin;

    sliderMaxEl.min = sliderMin;
    sliderMaxEl.max = sliderMax;
    sliderMaxEl.value = sliderMax;

    minPriceInput.min = sliderMin;
    minPriceInput.value = sliderMin;
    maxPriceInput.max = sliderMax;
    maxPriceInput.value = sliderMax;

    updateSliderFill();
    updateRangeDisplay();
  }

  function updateSliderFill() {
    var range = sliderMax - sliderMin;
    if (range <= 0) return;
    var minVal = parseInt(sliderMinEl.value);
    var maxVal = parseInt(sliderMaxEl.value);
    var left = ((minVal - sliderMin) / range) * 100;
    var right = 100 - ((maxVal - sliderMin) / range) * 100;
    sliderFill.style.left = left + '%';
    sliderFill.style.right = right + '%';
  }

  function updateRangeDisplay() {
    var minVal = parseInt(sliderMinEl.value);
    var maxVal = parseInt(sliderMaxEl.value);
    if (minVal <= sliderMin && maxVal >= sliderMax) {
      rangeDisplay.textContent = 'any price';
    } else {
      rangeDisplay.textContent = '₹' + formatPrice(minVal) + ' – ₹' + formatPrice(maxVal);
    }
  }

  function onSliderChange() {
    var minVal = parseInt(sliderMinEl.value);
    var maxVal = parseInt(sliderMaxEl.value);

    // Prevent crossing
    if (minVal > maxVal) {
      if (this === sliderMinEl) {
        sliderMinEl.value = maxVal;
        minVal = maxVal;
      } else {
        sliderMaxEl.value = minVal;
        maxVal = minVal;
      }
    }

    minPriceInput.value = minVal;
    maxPriceInput.value = maxVal;
    updateSliderFill();
    updateRangeDisplay();
    debounceFetch(minVal, maxVal);
  }

  function onNumberChange() {
    var minVal = parseInt(minPriceInput.value) || sliderMin;
    var maxVal = parseInt(maxPriceInput.value) || sliderMax;

    if (minVal > maxVal) {
      minVal = maxVal;
      minPriceInput.value = minVal;
    }

    sliderMinEl.value = minVal;
    sliderMaxEl.value = maxVal;
    updateSliderFill();
    updateRangeDisplay();
    debounceFetch(minVal, maxVal);
  }

  function debounceFetch(minVal, maxVal) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var sendMin = minVal > sliderMin ? minVal : undefined;
      var sendMax = maxVal < sliderMax ? maxVal : undefined;
      fetchHotels(currentCity, sendMin, sendMax, false);
    }, 300);
  }

  // ── Banner ──
  function showBanner(msg) {
    partialBannerText.textContent = msg;
    partialBanner.hidden = false;
  }

  function hideBanner() {
    partialBanner.hidden = true;
  }

  // ── Health polling ──
  async function pollHealth() {
    try {
      var resp = await fetch('/health');
      var data = await resp.json();

      var dotA = document.getElementById('dot-a');
      var dotB = document.getElementById('dot-b');
      var statusA = document.getElementById('status-a');
      var statusB = document.getElementById('status-b');

      dotA.className = 'status-dot ' + data.suppliers.supplierA;
      dotB.className = 'status-dot ' + data.suppliers.supplierB;
      statusA.textContent = data.suppliers.supplierA;
      statusB.textContent = data.suppliers.supplierB;
    } catch (e) {
      // Silently handle
    }
  }

  // ── Supplier toggles ──
  async function toggleSupplier(name) {
    try {
      await fetch('/admin/supplier/' + name + '/toggle', { method: 'POST' });
      // Immediately poll health to update pills
      pollHealth();
    } catch (e) {
      // Silently handle
    }
  }

  // ── Event listeners ──
  findBtn.addEventListener('click', function () {
    var city = cityInput.value.trim();
    if (!city) {
      cityInput.focus();
      return;
    }
    currentSort = 'price-asc';
    document.querySelectorAll('.sort-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-sort') === 'price-asc');
    });
    fetchHotels(city, undefined, undefined, false);
  });

  refreshBtn.addEventListener('click', function () {
    var city = cityInput.value.trim();
    if (!city) return;
    fetchHotels(city, undefined, undefined, true);
  });

  cityInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      findBtn.click();
    }
  });

  sliderMinEl.addEventListener('input', onSliderChange);
  sliderMaxEl.addEventListener('input', onSliderChange);
  minPriceInput.addEventListener('input', onNumberChange);
  maxPriceInput.addEventListener('input', onNumberChange);

  bannerClose.addEventListener('click', hideBanner);

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentSort = this.getAttribute('data-sort');
      document.querySelectorAll('.sort-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-sort') === currentSort);
      });
      renderHotels(getSortedHotels(currentHotels, currentSort));
    });
  });

  // Supplier toggles
  document.getElementById('toggle-a').addEventListener('change', function () {
    toggleSupplier('a');
  });
  document.getElementById('toggle-b').addEventListener('change', function () {
    toggleSupplier('b');
  });

  // ── Init ──
  pollHealth();
  setInterval(pollHealth, 15000);
})();
