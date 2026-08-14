(function() {
    const DATA_URL_BR = 'https://v6-coder.github.io/data/database.br';
    const DATA_URL_GZIP = 'https://v6-coder.github.io/data/database.gzip';
    const LOCAL_DATA_URL = './database.json';
    const APP_VERSION = '20260704';
    const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1520027002516541531/EimI6_678qAOKrkLGsjSleUGuxpeqt7Aou40NM07VXhKCvYKX2uY0Nh24h-EF0c-tBlF';
    let currentSort = 'default';
    const FAVOURITES_KEY = 'marketplace_favourites';
    let itemsData = [];
    let shareCodeToUuid = new Map();
    let mediumCodeToUuid = new Map();
    const SHARE_CODE_BASE_DLC = 'https://dlc-1.vercel.app';
    const SHARE_CODE_BASE_NETLIFY = 'https://marketplacedlc.netlify.app';
    const SHARE_CODE_RE = /^[a-z0-9]{4}$/i;

    function normalizeShareNamePart(title) {
        const normalized = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const part = normalized.slice(0, 1);
        return part.padEnd(1, 'x');
    }

    function generateShareCode(title, uuid) {
        const namePart = normalizeShareNamePart(title);
        const idPart = String(uuid || '').toLowerCase().slice(0, 3);
        return `${namePart}${idPart}`;
    }

    function generateTitleSlug(title) {
        return title.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    }

    function generateMediumCode(item) {
        const uuidPrefix = String(item.uuid).toLowerCase().slice(0, 2);
        const titleSlug = generateTitleSlug(item.title);
        return `${uuidPrefix}-${titleSlug}`;
    }

    function buildShareCodeIndex() {
        shareCodeToUuid.clear();
        mediumCodeToUuid.clear();
        itemsData.forEach(item => {
            const shortCode = generateShareCode(item.title, item.uuid).toLowerCase();
            const mediumCode = generateMediumCode(item).toLowerCase();
            const uuidLower = String(item.uuid).toLowerCase();
            shareCodeToUuid.set(shortCode, uuidLower);
            mediumCodeToUuid.set(mediumCode, uuidLower);
        });
    }

    function getHashFromUrl() {
        return window.location.hash ? window.location.hash.slice(1) : null;
    }

    function isBrotliCatalogUrl(candidateUrl) {
        try {
            const urlObject = new URL(String(candidateUrl), window.location.href);
            return urlObject.pathname.toLowerCase().endsWith('.br');
        } catch (error) {
            return String(candidateUrl).toLowerCase().endsWith('.br');
        }
    }

    function isGzipCatalogUrl(candidateUrl) {
        try {
            const urlObject = new URL(String(candidateUrl), window.location.href);
            return urlObject.pathname.toLowerCase().endsWith('.gzip');
        } catch (error) {
            return String(candidateUrl).toLowerCase().endsWith('.gzip');
        }
    }

    async function parseCatalogPayload(response, candidateUrl) {
        const contentEncoding = (response.headers.get('content-encoding') || '').toLowerCase();
        const isBrPayload = contentEncoding.includes('br') || isBrotliCatalogUrl(candidateUrl);
        const isGzipPayload = contentEncoding.includes('gzip') || isGzipCatalogUrl(candidateUrl);

        if (isBrPayload && typeof DecompressionStream !== 'undefined') {
            const buffer = await response.arrayBuffer();
            const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('br'));
            const text = await new Response(stream).text();
            return JSON.parse(text);
        }

        if (isGzipPayload && typeof DecompressionStream !== 'undefined') {
            const buffer = await response.arrayBuffer();
            const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
            const text = await new Response(stream).text();
            return JSON.parse(text);
        }

        const text = await response.text();
        return JSON.parse(text);
    }

    function buildCatalogUrl(url) {
        const normalized = String(url || '').trim();
        if (!normalized) return normalized;

        try {
            const urlObject = new URL(normalized, window.location.href);
            if (!urlObject.searchParams.has('v')) {
                urlObject.searchParams.set('v', APP_VERSION);
            }
            return urlObject.toString();
        } catch (error) {
            const separator = normalized.includes('?') ? '&' : '?';
            return `${normalized}${separator}v=${APP_VERSION}`;
        }
    }

    const ITEMS_PER_PAGE = 15;
    let currentPage = 1;
    let allFilteredSortedItems = [];
    let isLoading = false;
    let hasMoreItems = true;
    let slideTrack, sliderPrev, sliderNext, sliderUp, sliderDots, panoramaSlider;

    function createStars() {
        const container = document.getElementById('stars');
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 50; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            const size = Math.random() * 2 + 1;
            s.style.width = s.style.height = `${size}px`;
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.setProperty('--anim-dur', `${Math.random() * 3 + 2}s`);
            frag.appendChild(s);
        }
        container.appendChild(frag);
    }

    function loadFavourites() {
        try {
            const raw = localStorage.getItem(FAVOURITES_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr : []);
        } catch {
            return new Set();
        }
    }

    function saveFavourites(favsSet) {
        try {
            localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from(favsSet)));
        } catch {}
    }

    function updateNameSortLabel() {
        const icon = document.getElementById('nameSortIcon');
        const label = document.getElementById('nameSortLabel');
        if (!icon || !label) return;
        if (currentSort === 'nameDesc') {
            icon.className = 'fas fa-sort-alpha-up';
            label.textContent = 'Name (Z-A)';
        } else {
            icon.className = 'fas fa-sort-alpha-down';
            label.textContent = 'Name (A-Z)';
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function createItemCard(rawItem, index) {
        const categoryNames = { worlds: 'World', addons: 'Addon', mashups: 'Mashup', textures: 'Texture', skins: 'Skin' };
        const item = {
            uuid: rawItem.uuid || rawItem.id || `item-${index}`,
            title: rawItem.title || rawItem.name || 'Untitled',
            category: rawItem.category || 'worlds',
            subtitle: rawItem.subtitle || categoryNames[rawItem.category] || 'Item',
            image: rawItem.image || rawItem.image_url || '',
            creator: rawItem.creator || '',
            panorama: rawItem.panorama || rawItem.panorama_url || '',
            ytEmbed: rawItem.yt_embed || '',
            description: rawItem.description || '',
            rating: rawItem.rating != null && rawItem.rating !== '' ? Number(rawItem.rating) : null,
            totalRatings: rawItem.total_ratings != null && rawItem.total_ratings !== '' ? Number(rawItem.total_ratings) : 0,
            extraImages: Array.isArray(rawItem.extra_images) ? rawItem.extra_images : [],
            links: Array.isArray(rawItem.links) ? rawItem.links : []
        };
        const card = document.createElement('article');
        card.className = 'item';
        card.dataset.uuid = item.uuid;
        card.dataset.category = item.category;
        const content = document.createElement('div');
        content.className = 'item-content';
        const title = document.createElement('h2');
        title.textContent = item.title;
        const titleRow = document.createElement('div');
        titleRow.className = 'title-row';
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'subtitle';
        subtitleEl.textContent = item.subtitle;
        const downloadCountEl = document.createElement('div');
        downloadCountEl.className = 'download-count';
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'img-wrapper';
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = item.title;
        img.loading = 'lazy';
        imgWrapper.appendChild(img);
        const description = document.createElement('div');
        description.className = 'description';
        description.innerHTML = escapeHtml(item.description).replace(/\n/g, '<br>');
        const ytEmbed = document.createElement('div');
        ytEmbed.className = 'yt-embed';
        ytEmbed.textContent = item.ytEmbed;
        const panoramaUrl = document.createElement('div');
        panoramaUrl.className = 'panorama-url';
        panoramaUrl.textContent = item.panorama;
        const creator = document.createElement('div');
        creator.className = 'item-creator';
        creator.textContent = item.creator;
        const rating = document.createElement('div');
        rating.className = 'item-rating';
        rating.textContent = item.rating !== null ? String(item.rating) : '';
        const totalRatings = document.createElement('div');
        totalRatings.className = 'item-total-ratings';
        totalRatings.textContent = item.totalRatings > 0 ? String(item.totalRatings) : '';
        titleRow.appendChild(subtitleEl);
        titleRow.appendChild(downloadCountEl);
        content.appendChild(title);
        content.appendChild(titleRow);
        content.appendChild(imgWrapper);
        content.appendChild(description);
        content.appendChild(ytEmbed);
        content.appendChild(panoramaUrl);
        content.appendChild(creator);
        content.appendChild(rating);
        content.appendChild(totalRatings);
        card.appendChild(content);
        item.extraImages.forEach((extraImage, extraIndex) => {
            const extraWrapper = document.createElement('div');
            extraWrapper.className = `img-wrapper-${extraIndex + 1}`;
            const extraImg = document.createElement('img');
            extraImg.src = extraImage;
            extraImg.alt = `${item.title} screenshot ${extraIndex + 1}`;
            extraImg.loading = 'lazy';
            extraWrapper.appendChild(extraImg);
            card.appendChild(extraWrapper);
        });
        return card;
    }

    function buildHiddenLinksContainer(item) {
        const container = document.createElement('div');
        container.className = 'item-links';
        container.dataset.uuid = item.uuid;
        if (!item.links || !item.links.length) {
            const emptyLink = document.createElement('a');
            emptyLink.className = 'download-link';
            emptyLink.href = '#';
            emptyLink.rel = 'noopener noreferrer';
            emptyLink.innerHTML = '<span class="link-text"><i class="fas fa-download"></i> No download link</span>';
            container.appendChild(emptyLink);
            return container;
        }
        return container;
    }

    async function loadMarketplaceData() {
        const loader = document.getElementById('initialLoader');
        const loaderText = loader?.querySelector('p');
        if (loaderText) loaderText.textContent = '@MCF2P';
        const fallbackUrls = [
            buildCatalogUrl(DATA_URL_BR),
            buildCatalogUrl(DATA_URL_GZIP),
            buildCatalogUrl(LOCAL_DATA_URL),
            buildCatalogUrl(`${LOCAL_DATA_URL}.br`),
            buildCatalogUrl(`${LOCAL_DATA_URL}.gzip`),
        ];
        let payload = null;
        for (const url of fallbackUrls) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (response.ok) {
                    payload = await parseCatalogPayload(response, url);
                    break;
                }
            } catch (error) {
                console.warn('Failed to load marketplace data from', url, error);
            }
        }
        const items = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.items) ? payload.items : []);
        loadDownloadCounts(items);
        updateStatistics();
        renderItems();
        setupInfiniteScroll();
        if (loader) loader.classList.add('hidden');
    }

    function loadDownloadCounts(sourceItems = []) {
        if (Array.isArray(sourceItems) && sourceItems.length && !sourceItems[0]?.nodeType) {
            itemsData = [];
            const categoryNames = { worlds: 'World', addons: 'Addon', mashups: 'Mashup', textures: 'Texture', skins: 'Skin' };
            sourceItems.forEach((item, index) => {
                const uuid = String(item.uuid || item.id || `item-${index}`);
                const title = item.title || item.name || 'Untitled';
                const category = item.category || 'worlds';
                const subtitle = item.subtitle || categoryNames[category] || 'Item';
                const image = item.image || item.image_url || '';
                const creator = item.creator || '';
                const panorama = item.panorama || item.panorama_url || '';
                const rating = item.rating != null && item.rating !== '' ? Number(item.rating) : null;
                const totalRatings = item.total_ratings != null && item.total_ratings !== '' ? Number(item.total_ratings) : 0;
                const savedData = localStorage.getItem(`item_${uuid}`);
                let downloadCount = 0;
                let lastUpdated = new Date().toISOString().split('T')[0];
                if (savedData) {
                    const parsed = JSON.parse(savedData);
                    downloadCount = parsed.downloadCount || 0;
                    lastUpdated = parsed.lastUpdated || lastUpdated;
                }
                const originalElement = createItemCard({ ...item, uuid, title, category, subtitle, image, creator,
                    panorama, rating, total_ratings: totalRatings }, index);
                itemsData.push({ uuid, title, category, subtitle, image, creator, panorama, rating, totalRatings,
                    links: Array.isArray(item.links) ? item.links : [], element: originalElement.cloneNode(true),
                    originalElement, downloadCount, htmlIndex: index, lastUpdated });
            });
            const savedSort = localStorage.getItem('marketplace_sort');
            if (savedSort) {
                if (savedSort === 'recent') currentSort = 'newest';
                else if (savedSort === 'name') currentSort = 'nameAsc';
                else currentSort = savedSort;
                updateNameSortLabel();
                updateSortUI();
            }
            buildShareCodeIndex();
            return;
        }
        const items = document.querySelectorAll('.item');
        itemsData = [];
        items.forEach((item, index) => {
            const uuid = item.getAttribute('data-uuid');
            const title = item.querySelector('h2').textContent;
            const category = item.getAttribute('data-category');
            let subtitle = '';
            const subtitleEl = item.querySelector('.subtitle');
            if (subtitleEl) subtitle = subtitleEl.textContent;
            const image = item.querySelector('.img-wrapper img')?.src || '';
            const creator = item.querySelector('.item-creator')?.textContent?.trim() || '';
            const panorama = item.querySelector('.panorama-url')?.textContent?.trim() || '';
            const ratingRaw = item.querySelector('.item-rating')?.textContent?.trim() || '';
            const totalRatingsRaw = item.querySelector('.item-total-ratings')?.textContent?.trim() || '';
            const rating = ratingRaw === '' ? null : Number(ratingRaw);
            const totalRatings = totalRatingsRaw === '' ? 0 : Number(totalRatingsRaw);
            const savedData = localStorage.getItem(`item_${uuid}`);
            let downloadCount = 0;
            let lastUpdated = new Date().toISOString().split('T')[0];
            if (savedData) {
                const parsed = JSON.parse(savedData);
                downloadCount = parsed.downloadCount || 0;
                lastUpdated = parsed.lastUpdated || lastUpdated;
            }
            itemsData.push({ uuid, title, category, subtitle, image, creator, panorama, rating, totalRatings,
                element: item.cloneNode(true), originalElement: item, downloadCount, htmlIndex: index,
                lastUpdated });
        });
        const savedSort = localStorage.getItem('marketplace_sort');
        if (savedSort) {
            if (savedSort === 'recent') currentSort = 'newest';
            else if (savedSort === 'name') currentSort = 'nameAsc';
            else currentSort = savedSort;
            updateNameSortLabel();
            updateSortUI();
        }
        buildShareCodeIndex();
    }

    function saveDownloadCount(uuid, count) {
        localStorage.setItem(`item_${uuid}`, JSON.stringify({ downloadCount: count, lastUpdated: new Date()
                .toISOString().split('T')[0] }));
    }

    function saveCurrentSort() { localStorage.setItem('marketplace_sort', currentSort); }

    function incrementDownloadCount(uuid) {
        const item = itemsData.find(item => item.uuid === uuid);
        if (item) {
            item.downloadCount++;
            item.lastUpdated = new Date().toISOString().split('T')[0];
            saveDownloadCount(uuid, item.downloadCount);
            updateItemDisplay();
        }
    }

    function updateItemDisplay() {
        const showDownloadCount = currentSort === 'popularity';
        document.querySelectorAll('.item').forEach(itemElement => {
            const uuid = itemElement.getAttribute('data-uuid');
            const item = itemsData.find(i => i.uuid === uuid);
            if (!item) return;
            let titleRow = itemElement.querySelector('.title-row');
            if (!titleRow) {
                const subtitle = itemElement.querySelector('.subtitle');
                const h2 = itemElement.querySelector('h2');
                if (subtitle && h2) {
                    titleRow = document.createElement('div');
                    titleRow.className = 'title-row';
                    subtitle.parentNode.insertBefore(titleRow, subtitle);
                    titleRow.appendChild(subtitle);
                    const itemContent = itemElement.querySelector('.item-content');
                    if (itemContent) itemContent.insertBefore(h2, titleRow);
                }
            }
            let downloadCountElement = itemElement.querySelector('.download-count');
            if (!downloadCountElement && titleRow) {
                downloadCountElement = document.createElement('div');
                downloadCountElement.className = 'download-count';
                titleRow.appendChild(downloadCountElement);
            }
            if (downloadCountElement) {
                downloadCountElement.innerHTML = `<i class="fas fa-download"></i> ${item.downloadCount}`;
                if (showDownloadCount) downloadCountElement.classList.add('show');
                else downloadCountElement.classList.remove('show');
            }
        });
    }

    function fixItemStructure(itemElement) {
        const itemContent = itemElement.querySelector('.item-content');
        if (!itemContent) return;
        const h2 = itemElement.querySelector('h2');
        const subtitle = itemElement.querySelector('.subtitle');
        const imgWrapper = itemElement.querySelector('.img-wrapper');
        const description = itemElement.querySelector('.description');
        const ytEmbed = itemElement.querySelector('.yt-embed');
        const panoramaUrl = itemElement.querySelector('.panorama-url');
        const creator = itemElement.querySelector('.item-creator');
        const rating = itemElement.querySelector('.item-rating');
        const totalRatings = itemElement.querySelector('.item-total-ratings');
        itemContent.innerHTML = '';
        if (h2) itemContent.appendChild(h2);
        const titleRow = document.createElement('div');
        titleRow.className = 'title-row';
        if (subtitle) titleRow.appendChild(subtitle);
        const downloadCountElement = document.createElement('div');
        downloadCountElement.className = 'download-count';
        titleRow.appendChild(downloadCountElement);
        itemContent.appendChild(titleRow);
        if (imgWrapper) itemContent.appendChild(imgWrapper);
        if (description) itemContent.appendChild(description);
        if (ytEmbed) itemContent.appendChild(ytEmbed);
        if (panoramaUrl) itemContent.appendChild(panoramaUrl);
        if (creator) itemContent.appendChild(creator);
        if (rating) itemContent.appendChild(rating);
        if (totalRatings) itemContent.appendChild(totalRatings);
        return { titleRow, downloadCountElement };
    }

    function sortItems(items) {
        const sorted = [...items];
        switch (currentSort) {
            case 'popularity':
                return sorted.sort((a, b) => b.downloadCount - a.downloadCount);
            case 'recent':
            case 'newest':
                return sorted.sort((a, b) => a.htmlIndex - b.htmlIndex);
            case 'oldest':
                return sorted.sort((a, b) => b.htmlIndex - a.htmlIndex);
            case 'name':
            case 'nameAsc':
                return sorted.sort((a, b) => a.title.localeCompare(b.title));
            case 'nameDesc':
                return sorted.sort((a, b) => b.title.localeCompare(a.title));
            case 'favourites':
                return sorted.sort((a, b) => b.htmlIndex - a.htmlIndex);
            default:
                return sorted.sort(() => Math.random() - 0.5);
        }
    }

    function getFilteredSortedItems() {
        const activeFilter = document.querySelector('.category-buttons button.active').dataset.filter;
        let filteredItems = itemsData;
        if (activeFilter !== 'all') filteredItems = itemsData.filter(item => item.category === activeFilter);
        if (currentSort === 'favourites') {
            const favs = loadFavourites();
            filteredItems = filteredItems.filter(item => favs.has(item.uuid));
        }
        return sortItems(filteredItems);
    }

    function resetPagination() { currentPage = 1;
        hasMoreItems = true;
        allFilteredSortedItems = getFilteredSortedItems(); }

    function cloneAndFixItem(item) {
        const clonedElement = item.originalElement.cloneNode(true);
        const fixed = fixItemStructure(clonedElement);
        if (fixed && fixed.downloadCountElement) {
            fixed.downloadCountElement.innerHTML = `<i class="fas fa-download"></i> ${item.downloadCount}`;
            if (currentSort === 'popularity') fixed.downloadCountElement.classList.add('show');
        }
        const imgElement = clonedElement.querySelector('.img-wrapper img');
        if (imgElement) {
            imgElement.setAttribute('loading', 'lazy');
            imgElement.src = item.image;
        }
        return clonedElement;
    }

    function renderCurrentPage() {
        const container = document.getElementById('itemContainer');
        container.innerHTML = '';
        if (!allFilteredSortedItems.length) {
            container.innerHTML = '<div class="no-items">No Results</div>';
            hasMoreItems = false;
            return;
        }
        const endIndex = Math.min(currentPage * ITEMS_PER_PAGE, allFilteredSortedItems.length);
        hasMoreItems = endIndex < allFilteredSortedItems.length;
        const batchSize = 6;
        let nextIndex = 0;

        function appendBatch() {
            const batchEnd = Math.min(nextIndex + batchSize, endIndex);
            for (let i = nextIndex; i < batchEnd; i++) {
                container.appendChild(cloneAndFixItem(allFilteredSortedItems[i]));
            }
            nextIndex = batchEnd;
            if (nextIndex < endIndex) {
                setTimeout(appendBatch, 60);
            }
        }
        appendBatch();
    }

    function loadMoreItems() {
        if (isLoading || !hasMoreItems) return;
        isLoading = true;
        const container = document.getElementById('itemContainer');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading-indicator';
        loadingDiv.id = 'loadingIndicator';
        loadingDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading';
        container.appendChild(loadingDiv);
        setTimeout(() => {
            document.getElementById('loadingIndicator')?.remove();
            const startIndex = currentPage * ITEMS_PER_PAGE;
            const endIndex = Math.min((currentPage + 1) * ITEMS_PER_PAGE, allFilteredSortedItems.length);
            for (let i = startIndex; i < endIndex; i++) {
                container.appendChild(cloneAndFixItem(allFilteredSortedItems[i]));
            }
            currentPage++;
            hasMoreItems = endIndex < allFilteredSortedItems.length;
            isLoading = false;
        }, 300);
    }

    function setupInfiniteScroll() {
        window.addEventListener('scroll', () => {
            if (isLoading || !hasMoreItems) return;
            if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 300) loadMoreItems();
        });
    }

    function updateSortUI() {
        document.querySelectorAll('.sort-option').forEach(opt => {
            const sort = opt.dataset.sort;
            const active = sort === 'name' ?
                (currentSort === 'nameAsc' || currentSort === 'nameDesc' || currentSort === 'name') :
                (opt.dataset.sort === currentSort || (sort === 'newest' && currentSort === 'recent'));
            opt.classList.toggle('active', active);
        });
    }

    function renderItems() { resetPagination();
        renderCurrentPage(); }

    function initSliderElements() {
        slideTrack = document.getElementById('sliderTrack');
        sliderPrev = document.getElementById('sliderPrev');
        sliderNext = document.getElementById('sliderNext');
        sliderUp = document.getElementById('sliderUp');
        sliderDots = document.getElementById('sliderDots');
        panoramaSlider = document.getElementById('panoramaSlider');
    }

    function extractYouTubeId(url) {
        const reg = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const match = url.match(reg);
        return match ? match[1] : null;
    }

    function buildSlidesFromItem(item) {
        const slides = [];
        const thumbnailImg = item.querySelector('.img-wrapper img');
        if (thumbnailImg) slides.push({ type: 'image', url: thumbnailImg.src, isPanorama: false });
        const ytDiv = item.querySelector('.yt-embed');
        if (ytDiv) {
            const ytText = ytDiv.textContent.trim();
            const ytId = extractYouTubeId(ytText);
            if (ytId) slides.push({ type: 'youtube', id: ytId, isPanorama: false });
        }
        const extraWrappers = Array.from(item.querySelectorAll('[class^="img-wrapper-"]'));
        extraWrappers.sort((a, b) => {
            const aNum = parseInt(a.className.match(/\d+/)?.[0] || '0', 10);
            const bNum = parseInt(b.className.match(/\d+/)?.[0] || '0', 10);
            return aNum - bNum;
        });
        extraWrappers.forEach(w => {
            const img = w.querySelector('img');
            if (img) slides.push({ type: 'image', url: img.src, isPanorama: false });
        });
        const panorama = item.querySelector('.panorama-url')?.textContent?.trim();
        if (panorama) slides.push({ type: 'image', url: panorama, isPanorama: true });
        return slides;
    }

    function renderSlider(slides) {
        if (!slideTrack) initSliderElements();
        const regularSlides = slides.filter(s => !s.isPanorama);
        const panoramaSlide = slides.find(s => s.isPanorama);
        const totalRegular = regularSlides.length;
        let currentIdx = 0;
        let panoramaMode = false;
        let panoramaPos = 0;

        function buildSlide(slide, panorama = false) {
            const slideDiv = document.createElement('div');
            slideDiv.className = `slider-slide${panorama ? ' panorama-mode' : ''}`;
            if (slide.type === 'image') {
                const img = document.createElement('img');
                img.src = slide.url;
                img.alt = '';
                img.loading = 'lazy';
                if (panorama) {
                    img.style.objectPosition = `${panoramaPos}% center`;
                    if (panoramaSlider) {
                        panoramaSlider.value = String(panoramaPos);
                        panoramaSlider.oninput = () => {
                            panoramaPos = Number(panoramaSlider.value);
                            img.style.objectPosition = `${panoramaPos}% center`;
                        };
                    }
                }
                slideDiv.appendChild(img);
            } else if (slide.type === 'youtube') {
                const iframe = document.createElement('iframe');
                iframe.src = `https://www.youtube.com/embed/${slide.id}?autoplay=0&rel=0`;
                iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
                iframe.allowFullscreen = true;
                slideDiv.appendChild(iframe);
            }
            return slideDiv;
        }

        function renderDots() {
            sliderDots.innerHTML = '';
            for (let i = 0; i < totalRegular; i++) {
                const dot = document.createElement('span');
                dot.className = `slider-dot ${i === currentIdx ? 'active' : ''}`;
                dot.dataset.index = i;
                dot.addEventListener('click', () => {
                    if (!panoramaMode) {
                        currentIdx = i;
                        renderRegular();
                    }
                });
                sliderDots.appendChild(dot);
            }
        }

        function updateSliderControls() {
            if (panoramaMode) {
                sliderPrev.style.display = 'flex';
                sliderNext.style.display = 'flex';
                sliderUp.style.display = 'flex';
                sliderDots.style.display = 'none';
                if (panoramaSlider) panoramaSlider.style.display = 'block';
                sliderPrev.style.display = 'none';
                sliderNext.style.display = 'none';
            } else {
                sliderPrev.style.display = currentIdx > 0 ? 'flex' : 'none';
                sliderNext.style.display = currentIdx < (totalRegular - 1) ? 'flex' : 'none';
                sliderUp.style.display = panoramaSlide ? 'flex' : 'none';
                sliderDots.style.display = totalRegular > 1 ? 'flex' : 'none';
                if (panoramaSlider) panoramaSlider.style.display = 'none';
            }
        }

        function renderRegular() {
            panoramaMode = false;
            slideTrack.innerHTML = '';
            regularSlides.forEach(slide => slideTrack.appendChild(buildSlide(slide, false)));
            slideTrack.style.transform = `translateX(-${currentIdx * 100}%)`;
            document.querySelectorAll('.slider-dot').forEach((dot, i) => dot.classList.toggle('active', i === currentIdx));
            updateSliderControls();
        }

        function renderPanorama() {
            if (!panoramaSlide) return;
            panoramaMode = true;
            panoramaPos = 0;
            slideTrack.innerHTML = '';
            slideTrack.appendChild(buildSlide(panoramaSlide, true));
            slideTrack.style.transform = 'translateX(0)';
            updateSliderControls();
        }
        sliderPrev.onclick = () => {
            if (panoramaMode) return;
            currentIdx = Math.max(0, currentIdx - 1);
            renderRegular();
        };
        sliderNext.onclick = () => {
            if (panoramaMode) return;
            currentIdx = Math.min(totalRegular - 1, currentIdx + 1);
            renderRegular();
        };
        sliderUp.onclick = () => {
            if (!panoramaSlide) return;
            if (panoramaMode) renderRegular();
            else renderPanorama();
        };
        if (!totalRegular && panoramaSlide) {
            panoramaMode = true;
            renderPanorama();
            return;
        }
        if (totalRegular > 1 && regularSlides[1].type === 'youtube') currentIdx = 1;
        renderDots();
        renderRegular();
    }

    function clearSlider() {
        if (slideTrack) slideTrack.innerHTML = '';
        if (sliderDots) sliderDots.innerHTML = '';
    }
    const overlay = document.getElementById('downloadOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalType = document.getElementById('modalType');
    const modalRating = document.getElementById('modalRating');
    const modalRatingValue = document.getElementById('modalRatingValue');
    const modalTotalRatings = document.getElementById('modalTotalRatings');
    const modalDescription = document.getElementById('modalDescription');
    const downloadLinks = document.getElementById('downloadLinks');
    const closeModal = document.getElementById('closeModal');
    const favouriteBtn = document.getElementById('favouriteBtn');
    const shareBtn = document.getElementById('shareBtn');
    let overlayItemUuid = null;
    let shareOverlayEl = null;

    function getHiddenLinksContainer() {
        return document.getElementById('hiddenLinks');
    }

    function getItemTypeLabel(itemData) {
        if (!itemData) return 'Download';
        if (itemData.subtitle) return itemData.subtitle;
        if (itemData.type) return itemData.type;
        const categoryNames = { worlds: 'World', addons: 'Addon', mashups: 'Mashup', textures: 'Texture', skins: 'Skin' };
        const category = String(itemData.category || '').toLowerCase();
        return categoryNames[category] || (itemData.category ? String(itemData.category) : 'Download');
    }

    async function copyTextToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                return true;
            } catch {
                return false;
            }
        }
    }

    function closeShareOverlay() {
        if (!shareOverlayEl) return;
        shareOverlayEl.classList.remove('active');
    }

    function showCopyFeedback(btn) {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
    }

    function ensureShareOverlayExists() {
        if (shareOverlayEl) return;
        shareOverlayEl = document.createElement('div');
        shareOverlayEl.id = 'shareOverlay';
        shareOverlayEl.className = 'overlay';
        shareOverlayEl.innerHTML = `
                <div class="share-modal" role="dialog" aria-modal="true" aria-label="Share options">
                    <button class="close-btn" id="closeShareOverlayBtn" type="button" aria-label="Close share overlay">
                        <i class="fas fa-times"></i>
                    </button>
                    <div class="share-title">Share</div>
                    <div class="share-label">Short</div>
                    <div class="share-link-row">
                        <div class="share-url" id="shortShareUrlDlc"></div>
                        <button class="copy-share-btn" id="copyShortDlcBtn" type="button" aria-label="Copy DLC link">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    <div class="share-link-row">
                        <div class="share-url" id="shortShareUrlNetlify"></div>
                        <button class="copy-share-btn" id="copyShortNetlifyBtn" type="button" aria-label="Copy Netlify link">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    <div class="share-label">Medium</div>
                    <div class="share-link-row">
                        <div class="share-url" id="mediumShareUrlDlc"></div>
                        <button class="copy-share-btn" id="copyMediumDlcBtn" type="button" aria-label="Copy DLC link">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    <div class="share-link-row">
                        <div class="share-url" id="mediumShareUrlNetlify"></div>
                        <button class="copy-share-btn" id="copyMediumNetlifyBtn" type="button" aria-label="Copy Netlify link">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </div>
            `;
        document.body.appendChild(shareOverlayEl);
        shareOverlayEl.addEventListener('click', (e) => {
            if (e.target === shareOverlayEl) closeShareOverlay();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && shareOverlayEl.classList.contains('active')) closeShareOverlay();
        });
        const closeBtn = shareOverlayEl.querySelector('#closeShareOverlayBtn');
        closeBtn?.addEventListener('click', closeShareOverlay);
        const copyShortDlcBtn = shareOverlayEl.querySelector('#copyShortDlcBtn');
        const shortDlcUrl = shareOverlayEl.querySelector('#shortShareUrlDlc');
        copyShortDlcBtn.addEventListener('click', async () => {
            await copyTextToClipboard(shortDlcUrl.textContent);
            showCopyFeedback(copyShortDlcBtn);
        });
        const copyShortNetlifyBtn = shareOverlayEl.querySelector('#copyShortNetlifyBtn');
        const shortNetlifyUrl = shareOverlayEl.querySelector('#shortShareUrlNetlify');
        copyShortNetlifyBtn.addEventListener('click', async () => {
            await copyTextToClipboard(shortNetlifyUrl.textContent);
            showCopyFeedback(copyShortNetlifyBtn);
        });
        const copyMediumDlcBtn = shareOverlayEl.querySelector('#copyMediumDlcBtn');
        const mediumDlcUrl = shareOverlayEl.querySelector('#mediumShareUrlDlc');
        copyMediumDlcBtn.addEventListener('click', async () => {
            await copyTextToClipboard(mediumDlcUrl.textContent);
            showCopyFeedback(copyMediumDlcBtn);
        });
        const copyMediumNetlifyBtn = shareOverlayEl.querySelector('#copyMediumNetlifyBtn');
        const mediumNetlifyUrl = shareOverlayEl.querySelector('#mediumShareUrlNetlify');
        copyMediumNetlifyBtn.addEventListener('click', async () => {
            await copyTextToClipboard(mediumNetlifyUrl.textContent);
            showCopyFeedback(copyMediumNetlifyBtn);
        });
    }

    function openShareOverlayForUuid(uuid) {
        ensureShareOverlayExists();
        const item = itemsData.find(i => String(i.uuid).toLowerCase() === String(uuid).toLowerCase());
        if (!item) return;
        const shortCode = generateShareCode(item.title, item.uuid);
        const mediumCode = generateMediumCode(item);
        const shortUrlDlc = `${SHARE_CODE_BASE_DLC}/#${shortCode}`;
        const shortUrlNetlify = `${SHARE_CODE_BASE_NETLIFY}/#${shortCode}`;
        const mediumUrlDlc = `${SHARE_CODE_BASE_DLC}/#${mediumCode}`;
        const mediumUrlNetlify = `${SHARE_CODE_BASE_NETLIFY}/#${mediumCode}`;
        shareOverlayEl.querySelector('#shortShareUrlDlc').textContent = shortUrlDlc;
        shareOverlayEl.querySelector('#shortShareUrlNetlify').textContent = shortUrlNetlify;
        shareOverlayEl.querySelector('#mediumShareUrlDlc').textContent = mediumUrlDlc;
        shareOverlayEl.querySelector('#mediumShareUrlNetlify').textContent = mediumUrlNetlify;
        shareOverlayEl.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function setFavouriteButtonForUuid(uuid) {
        if (!favouriteBtn) return;
        const favs = loadFavourites();
        const isFavourited = favs.has(uuid);
        favouriteBtn.classList.toggle('favourited', isFavourited);
        favouriteBtn.setAttribute('aria-pressed', String(isFavourited));
        const icon = favouriteBtn.querySelector('i');
        if (icon) {
            icon.style.color = isFavourited ? '#ff4d4d' : '';
        }
    }

    function toggleFavouriteForUuid(uuid) {
        const favs = loadFavourites();
        if (favs.has(uuid)) favs.delete(uuid);
        else favs.add(uuid);
        saveFavourites(favs);
        setFavouriteButtonForUuid(uuid);
        if (currentSort === 'favourites') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput.value.trim() !== '') {
                performSearch(searchInput.value.toLowerCase());
            } else {
                renderItems();
            }
        }
    }

    document.addEventListener('click', (e) => {
        const item = e.target.closest('.item');
        if (item && !e.target.closest('.download-count')) {
            const title = item.querySelector('h2').textContent;
            const subtitle = item.querySelector('.subtitle').textContent;
            const uuid = item.getAttribute('data-uuid');
            overlayItemUuid = uuid;
            setFavouriteButtonForUuid(uuid);
            modalTitle.textContent = title;
            const creatorSpan = item.querySelector('.item-creator');
            const creatorText = creatorSpan ? creatorSpan.textContent.trim() : '';
            modalType.innerHTML =
                `<span class="clickable-meta" data-meta-type="type">${subtitle}</span>${creatorText ? ` - <span class="clickable-meta" data-meta-type="creator">${creatorText}</span>` : ''}`;
            const ratingRaw = item.querySelector('.item-rating')?.textContent?.trim() || '';
            const totalRatingsRaw = item.querySelector('.item-total-ratings')?.textContent?.trim() || '';
            const ratingValue = ratingRaw === '' ? null : Number(ratingRaw);
            const totalRatingsValue = totalRatingsRaw === '' ? 0 : Number(totalRatingsRaw);
            if (ratingValue !== null && !Number.isNaN(ratingValue)) {
                modalRatingValue.textContent = ratingValue.toFixed(1);
                modalTotalRatings.textContent = `(${Number.isNaN(totalRatingsValue) ? 0 : totalRatingsValue.toLocaleString()})`;
                modalRating.style.display = 'block';
            } else {
                modalRating.style.display = 'none';
            }
            const descElem = item.querySelector('.description');
            if (descElem && descElem.innerHTML.trim() !== '') {
                modalDescription.innerHTML = descElem.innerHTML;
                modalDescription.style.display = 'block';
            } else {
                modalDescription.style.display = 'none';
                modalDescription.innerHTML = '';
            }
            downloadLinks.innerHTML = '';
            const hiddenLinks = getHiddenLinksContainer();
            const itemData = itemsData.find(i => String(i.uuid).toLowerCase() === String(uuid).toLowerCase());
            const itemTypeLabel = getItemTypeLabel(itemData);
            const itemLinkTypes = Array.isArray(itemData?.links) ? itemData.links : [];
            const itemLinksContainer = hiddenLinks?.querySelector(`.item-links[data-uuid="${uuid}"]`);
            const htmlLinks = hiddenLinks?.querySelectorAll(`a.hidden-download-link[id^="hiddenLink-${uuid}"]`);
            if (htmlLinks && htmlLinks.length) {
                htmlLinks.forEach((link, index) => {
                    const clonedLink = document.createElement('a');
                    clonedLink.className = 'download-link';
                    clonedLink.href = link.getAttribute('href') || '#';
                    clonedLink.target = '_blank';
                    clonedLink.rel = 'noopener noreferrer';
                    const linkTypeLabel = link.getAttribute('data-label')
                        || itemLinkTypes[index]?.type
                        || itemLinkTypes[index]?.label
                        || itemLinkTypes[index]?.file_type
                        || itemTypeLabel;
                    const linkSize = link.getAttribute('data-size')
                        || itemLinkTypes[index]?.size
                        || itemLinkTypes[index]?.file_size
                        || '';
                    clonedLink.innerHTML = `<span class="link-text"><i class="fas fa-download"></i> <span class="link-label">${escapeHtml(linkTypeLabel)}</span></span>${linkSize ? `<span class="file-size">${escapeHtml(linkSize)}</span>` : ''}`;
                    clonedLink.addEventListener('click', () => incrementDownloadCount(uuid));
                    downloadLinks.appendChild(clonedLink);
                });
            } else if (itemLinksContainer) {
                itemLinksContainer.querySelectorAll('.download-link').forEach(link => {
                    const clonedLink = link.cloneNode(true);
                    clonedLink.addEventListener('click', () => incrementDownloadCount(uuid));
                    downloadLinks.appendChild(clonedLink);
                });
            }
            const slides = buildSlidesFromItem(item);
            renderSlider(slides);
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    });

    function closeOverlay() {
        overlay.classList.remove('active');
        closeShareOverlay();
        document.body.style.overflow = '';
        clearSlider();
        overlayItemUuid = null;
    }
    closeModal.addEventListener('click', closeOverlay);
    const alertCloseBtn = document.getElementById('alertCloseBtn');
    const alertOverlay = document.getElementById('alertOverlay');
    alertCloseBtn?.addEventListener('click', () => {
        alertOverlay.classList.remove('active');
    });
    alertOverlay?.addEventListener('click', (e) => {
        if (e.target === alertOverlay) alertOverlay.classList.remove('active');
    });
    const successCloseBtn = document.getElementById('successCloseBtn');
    const successOverlay = document.getElementById('successOverlay');
    successCloseBtn?.addEventListener('click', () => {
        successOverlay.classList.remove('active');
    });
    successOverlay?.addEventListener('click', (e) => {
        if (e.target === successOverlay) successOverlay.classList.remove('active');
    });
    favouriteBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!overlayItemUuid) return;
        toggleFavouriteForUuid(overlayItemUuid);
    });
    shareBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!overlayItemUuid) return;
        openShareOverlayForUuid(overlayItemUuid);
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeOverlay();
    });

    function extractUuidFromSearchText(text) {
        if (!text) return null;
        let t = String(text).trim();
        if (!t) return null;
        if (t.startsWith('#')) {
            t = t.slice(1);
        }
        const uuidMatch = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) return uuidMatch[0].toLowerCase();
        if (SHARE_CODE_RE.test(t)) {
            const mapped = shareCodeToUuid.get(t.toLowerCase());
            if (mapped) return mapped;
        }
        const mappedMedium = mediumCodeToUuid.get(t.toLowerCase());
        if (mappedMedium) return mappedMedium;
        return null;
    }
    let searchTimeout;
    let lastSearchQuery = '';
    let currentCategory = 'all';

    function getBaseItems() {
        let baseItems = itemsData;
        if (currentCategory !== 'all') {
            baseItems = baseItems.filter(item => item.category === currentCategory);
        }
        if (currentSort === 'favourites') {
            const favs = loadFavourites();
            baseItems = baseItems.filter(item => favs.has(item.uuid));
        }
        return sortItems(baseItems);
    }

    function normalizeString(str) {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function saveThemePreferences() {
        const prefs = {
            bgColor: document.getElementById('themeBgColor').value,
            titleColor: document.getElementById('themeTitleColor').value,
            typeColor: document.getElementById('themeTypeColor').value,
            descColor: document.getElementById('themeDescColor').value,
            iconsColor: document.getElementById('themeIconsColor').value,
            fontStyle: document.querySelector('.font-style-btn.active')?.dataset.fontStyle || 'rubik'
        };
        localStorage.setItem('marketplace_theme', JSON.stringify(prefs));
    }

    function loadThemePreferences() {
        const data = localStorage.getItem('marketplace_theme');
        if (!data) return;
        try {
            const prefs = JSON.parse(data);
            if (prefs.bgColor) document.getElementById('themeBgColor').value = prefs.bgColor;
            if (prefs.titleColor) document.getElementById('themeTitleColor').value = prefs.titleColor;
            if (prefs.typeColor) document.getElementById('themeTypeColor').value = prefs.typeColor;
            if (prefs.descColor) document.getElementById('themeDescColor').value = prefs.descColor;
            if (prefs.iconsColor) document.getElementById('themeIconsColor').value = prefs.iconsColor;
            if (prefs.fontStyle) {
                document.querySelectorAll('.font-style-btn').forEach(btn => btn.classList.toggle('active', btn
                    .dataset.fontStyle === prefs.fontStyle));
            }
            const applyButton = document.getElementById('applyThemeBtn');
            if (applyButton) applyButton.click();
        } catch (e) {
            console.warn('Failed to load theme preferences', e);
        }
    }

    function hideInitialLoader() {
        const loader = document.getElementById('initialLoader');
        if (loader) loader.classList.add('hidden');
    }

    function performSearch(searchQuery) {
        const container = document.getElementById('itemContainer');
        if (searchQuery.trim() === '') {
            lastSearchQuery = '';
            allFilteredSortedItems = getBaseItems();
            container.innerHTML = '';
            currentPage = 1;
            hasMoreItems = allFilteredSortedItems.length > ITEMS_PER_PAGE;
            const endIndex = Math.min(ITEMS_PER_PAGE, allFilteredSortedItems.length);
            for (let i = 0; i < endIndex; i++) {
                container.appendChild(cloneAndFixItem(allFilteredSortedItems[i]));
            }
            if (allFilteredSortedItems.length === 0) {
                container.innerHTML = '<div class="no-items">No Results</div>';
            }
            return;
        }
        lastSearchQuery = searchQuery;
        container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Searching</div>';
        setTimeout(() => {
            const directId = extractUuidFromSearchText(searchQuery);
            if (directId) {
                const found = itemsData.find(item => String(item.uuid).toLowerCase() === directId);
                if (found) {
                    if (currentCategory !== 'all' && found.category !== currentCategory) {
                        allFilteredSortedItems = [];
                    } else if (currentSort === 'favourites') {
                        const favs = loadFavourites();
                        allFilteredSortedItems = favs.has(found.uuid) ? [found] : [];
                    } else {
                        allFilteredSortedItems = [found];
                    }
                } else {
                    allFilteredSortedItems = [];
                }
                container.innerHTML = '';
                currentPage = 1;
                hasMoreItems = false;
                if (allFilteredSortedItems.length > 0) {
                    container.appendChild(cloneAndFixItem(allFilteredSortedItems[0]));
                } else {
                    container.innerHTML = '<div class="no-items">No Results</div>';
                }
                return;
            }
            const baseItems = getBaseItems();
            const normalizedQuery = normalizeString(searchQuery);
            const filtered = baseItems.filter(item => {
                const titleMatch = normalizeString(item.title).includes(normalizedQuery);
                const creatorMatch = normalizeString(item.creator || '').includes(normalizedQuery);
                const typeMatch = normalizeString(item.subtitle || '').includes(normalizedQuery);
                return titleMatch || creatorMatch || typeMatch;
            });
            allFilteredSortedItems = filtered;
            container.innerHTML = '';
            currentPage = 1;
            hasMoreItems = filtered.length > ITEMS_PER_PAGE;
            const endIndex = Math.min(ITEMS_PER_PAGE, filtered.length);
            for (let i = 0; i < endIndex; i++) {
                container.appendChild(cloneAndFixItem(filtered[i]));
            }
            if (filtered.length === 0) container.innerHTML = '<div class="no-items">No Results</div>';
        }, 300);
    }

    function applyModalQuickFilter(metaType, value) {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput || !value) return;
        if (metaType === 'type') {
            const typeToCategory = { 'world': 'worlds', 'addon': 'addons', 'add-on': 'addons', 'texture': 'textures',
                'skin': 'skins', 'mashup': 'mashups' };
            const key = String(value).toLowerCase().trim();
            const category = typeToCategory[key] || 'all';
            const categoryBtn = document.querySelector(`.category-buttons button[data-filter="${category}"]`);
            if (categoryBtn) categoryBtn.click();
            searchInput.value = value;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        searchInput.value = value;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    modalType.addEventListener('click', (e) => {
        const target = e.target.closest('.clickable-meta');
        if (!target) return;
        const metaType = target.getAttribute('data-meta-type');
        const value = target.textContent.trim();
        closeOverlay();
        applyModalQuickFilter(metaType, value);
    });
    document.getElementById('searchInput').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(q);
        }, 500);
    });
    document.querySelectorAll('.category-buttons button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-buttons button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.filter;
            const searchInput = document.getElementById('searchInput');
            if (searchInput.value.trim() !== '') {
                performSearch(searchInput.value.toLowerCase());
            } else {
                allFilteredSortedItems = getBaseItems();
                renderItems();
            }
        });
    });
    const settingsBtn = document.getElementById('settingsBtn');
    const sortDropdown = document.getElementById('sortDropdown');
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsBtn.classList.toggle('active');
        sortDropdown.classList.toggle('active');
    });
    document.querySelectorAll('.sort-option').forEach(option => {
        option.addEventListener('click', () => {
            if (option.dataset.sort === 'themes') {
                document.getElementById('themesPanel').classList.add('active');
                document.getElementById('themesOverlay').classList.add('active');
                document.getElementById('informationSection').classList.remove('show');
                document.body.style.overflow = 'hidden';
                settingsBtn.classList.remove('active');
                sortDropdown.classList.remove('active');
                return;
            }
            if (option.dataset.sort === 'information') {
                document.getElementById('informationSection').classList.add('show');
                document.getElementById('themesPanel').classList.remove('active');
                document.getElementById('themesOverlay').classList.add('active');
                document.getElementById('statisticsArea').classList.add('show');
                document.body.style.overflow = 'hidden';
                updateStatistics();
                settingsBtn.classList.remove('active');
                sortDropdown.classList.remove('active');
                return;
            }
            document.getElementById('themesPanel').classList.remove('active');
            document.getElementById('themesOverlay').classList.remove('active');
            document.getElementById('informationSection').classList.remove('show');
            document.getElementById('statisticsArea').classList.remove('show');
            if (option.dataset.sort === 'name') {
                currentSort = (currentSort === 'nameAsc') ? 'nameDesc' : 'nameAsc';
                updateNameSortLabel();
            } else {
                currentSort = option.dataset.sort;
            }
            updateSortUI();
            saveCurrentSort();
            const searchInput = document.getElementById('searchInput');
            if (searchInput.value.trim() !== '') {
                performSearch(searchInput.value.toLowerCase());
            } else {
                allFilteredSortedItems = getBaseItems();
                renderItems();
            }
            settingsBtn.classList.remove('active');
            sortDropdown.classList.remove('active');
        });
    });
    document.querySelectorAll('.font-style-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.font-style-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });
    document.getElementById('themesOverlay').addEventListener('click', () => {
        document.getElementById('themesPanel').classList.remove('active');
        document.getElementById('informationSection').classList.remove('show');
        document.getElementById('themesOverlay').classList.remove('active');
        document.body.style.overflow = '';
    });
    document.getElementById('applyThemeBtn').addEventListener('click', () => {
        const root = document.documentElement;
        const titleColor = document.getElementById('themeTitleColor').value;
        const iconsColor = document.getElementById('themeIconsColor').value;
        root.style.setProperty('--gradient-colors',
            `linear-gradient(270deg, ${document.getElementById('themeBgColor').value}, ${document.getElementById('themeBgColor').value}, ${document.getElementById('themeBgColor').value})`
            );
        root.style.setProperty('--text-color', titleColor);
        root.style.setProperty('--item-type-color', document.getElementById('themeTypeColor').value);
        root.style.setProperty('--desc-color', document.getElementById('themeDescColor').value);
        root.style.setProperty('--icons-color', iconsColor);
        document.querySelectorAll('.item h2, h1, h2, h3, h4').forEach(el => el.style.color = titleColor);
        document.querySelectorAll('.sort-option, .sort-dropdown, .settings-btn').forEach(el => el.style.color =
            titleColor);
        const typeColor = document.getElementById('themeTypeColor').value;
        document.querySelectorAll('.subtitle').forEach(el => el.style.color = typeColor);
        document.querySelectorAll(
                '.category-buttons button, .settings-btn, .search-wrapper button, .request-wrapper button, .favourite-btn, .share-btn, .close-btn, .slider-prev, .slider-next, .slider-up, .slider-down, .copy-share-btn, .panel-close-btn, .sort-option i, .social-links a, .download-link .link-icon, .download-link .link-arrow, .download-guide-btn'
                )
            .forEach(el => el.style.color = iconsColor);
        document.querySelectorAll('.download-link .file-size, .modal .file-size').forEach(el => {
            el.style.color = '';
            el.style.removeProperty('color');
        });
        document.querySelectorAll('.modal-description').forEach(el => el.style.color = document.getElementById(
            'themeDescColor').value);
        const activeFontButton = document.querySelector('.font-style-btn.active');
        const fontStyle = activeFontButton ? activeFontButton.dataset.fontStyle : 'rubik';
        let fontFamily = "'Rubik', sans-serif";
        if (fontStyle === 'mcpefont') {
            fontFamily = "'MCPEfont', 'Courier New', monospace";
        } else if (fontStyle === 'pixel') {
            fontFamily = "'Press Start 2P', 'Courier New', cursive";
        } else if (fontStyle === 'poppins') {
            fontFamily = "'Poppins', 'Segoe UI', sans-serif";
        } else if (fontStyle === 'montserrat') {
            fontFamily = "'Montserrat', 'Segoe UI', sans-serif";
        } else if (fontStyle === 'oswald') {
            fontFamily = "'Oswald', 'Segoe UI', sans-serif";
        }
        document.body.style.fontFamily = fontFamily;
        document.querySelectorAll(
                'h1, h2, h3, h4, .item h2, .modal-title, .sort-option, .category-buttons button, .settings-btn'
                )
            .forEach(el => {
                el.style.fontFamily = fontFamily;
            });
        saveThemePreferences();
    });
    document.getElementById('resetThemeBtn').addEventListener('click', () => {
        const root = document.documentElement;
        root.style.setProperty('--gradient-colors', 'linear-gradient(270deg, #0f0c29, #302b63, #24243e)');
        root.style.setProperty('--text-color', '#fff');
        root.style.setProperty('--item-type-color', '#ccc');
        root.style.setProperty('--desc-color', '#ddd');
        root.style.setProperty('--icons-color', '#fff');
        document.querySelectorAll('.item h2, h1, h2, h3, h4, .sort-option, .sort-dropdown, .settings-btn')
            .forEach(el => el.style.color = '');
        document.querySelectorAll('.subtitle').forEach(el => el.style.color = '');
        document.querySelectorAll(
                '.category-buttons button, .settings-btn, .search-wrapper button, .request-wrapper button, .favourite-btn, .share-btn, .close-btn, .slider-prev, .slider-next, .slider-up, .slider-down, .copy-share-btn, .panel-close-btn, .sort-option i, .social-links a, .download-link .link-icon, .download-link .link-arrow, .download-guide-btn'
                )
            .forEach(el => el.style.color = '');
        document.querySelectorAll('.download-link .file-size, .modal .file-size').forEach(el => {
            el.style.color = '';
            el.style.removeProperty('color');
        });
        document.querySelectorAll('.modal-description').forEach(el => el.style.color = '');
        document.body.style.fontFamily = "'Rubik', sans-serif";
        document.querySelectorAll(
                'h1, h2, h3, h4, .item h2, .modal-title, .sort-option, .category-buttons button, .settings-btn'
                )
            .forEach(el => {
                el.style.fontFamily = '';
            });
        document.getElementById('themeBgColor').value = '#0f0c29';
        document.getElementById('themeTitleColor').value = '#ffffff';
        document.getElementById('themeTypeColor').value = '#cccccc';
        document.getElementById('themeDescColor').value = '#dddddd';
        document.getElementById('themeIconsColor').value = '#ffffff';
        document.querySelectorAll('.font-style-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.font-style-btn[data-font-style="rubik"]').classList.add('active');
        const defaultFontBtn = document.querySelector('.font-style-btn[data-font-style="rubik"]');
        if (defaultFontBtn) {
            defaultFontBtn.classList.add('active');
        }
        localStorage.removeItem('marketplace_theme');
    });
    document.getElementById('closeThemesBtn').addEventListener('click', () => {
        document.getElementById('themesPanel').classList.remove('active');
        document.getElementById('themesOverlay').classList.remove('active');
        document.body.style.overflow = '';
    });
    document.getElementById('closeInfoBtn').addEventListener('click', () => {
        document.getElementById('informationSection').classList.remove('show');
        document.getElementById('themesOverlay').classList.remove('active');
        document.body.style.overflow = '';
    });

    function updateStatistics() {
        const all = itemsData.length;
        const worlds = itemsData.filter(item => item.category === 'worlds').length;
        const addons = itemsData.filter(item => item.category === 'addons').length;
        const mashups = itemsData.filter(item => item.category === 'mashups').length;
        const textures = itemsData.filter(item => item.category === 'textures').length;
        const skins = itemsData.filter(item => item.category === 'skins').length;
        const favs = loadFavourites();
        document.getElementById('statAll').textContent = all;
        document.getElementById('statWorlds').textContent = worlds;
        document.getElementById('statAddons').textContent = addons;
        document.getElementById('statMashups').textContent = mashups;
        document.getElementById('statTextures').textContent = textures;
        document.getElementById('statSkins').textContent = skins;
        document.getElementById('statFavourites').textContent = favs.size;
    }
    document.addEventListener('click', (e) => {
        if (sortDropdown && settingsBtn && !sortDropdown.contains(e.target) && !settingsBtn.contains(e
                .target)) {
            settingsBtn.classList.remove('active');
            sortDropdown.classList.remove('active');
        }
    });

    function isValidMarketplaceLink(url) {
        return /^https:\/\/www\.minecraft\.net\/en-us\/marketplace\//.test(url) || /^https:\/\/marketplace\.minecraft\.net\/en-us\/pdp\?id=/
            .test(url);
    }
    document.getElementById('sendButton').addEventListener('click', async () => {
        const inp = document.getElementById('linkInput');
        const url = inp.value.trim();
        if (!isValidMarketplaceLink(url)) {
            const alertOverlay = document.getElementById('alertOverlay');
            alertOverlay.classList.add('active');
            return;
        }
        const btn = document.getElementById('sendButton');
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            const res = await fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `Request: ${url}` })
            });
            if (!res.ok) throw new Error();
            const successOverlay = document.getElementById('successOverlay');
            successOverlay.classList.add('active');
            inp.value = '';
        } catch {
            alert('Failed to send request');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
    });
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadMarketplaceData();
        } catch (error) {
            console.error('Failed to load marketplace data', error);
            const container = document.getElementById('itemContainer');
            if (container) container.innerHTML = '<div class="no-items">Failed to load marketplace data.</div>';
        }
        const categoryNames = { worlds: "World", addons: "Addon", mashups: "Mashup", textures: "Texture",
            skins: "Skin" };
        itemsData.forEach(item => {
            const cat = item.category;
            item.subtitle = categoryNames[cat] || "Item";
            const subtitleEl = item.originalElement && item.originalElement.querySelector('.subtitle');
            if (subtitleEl) subtitleEl.textContent = item.subtitle;
        });
        const hash = getHashFromUrl();
        if (hash) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = hash;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        const logo = document.getElementById('logo');
        logo.addEventListener('click', () => {
            window.location.reload();
        });
        initSliderElements();
        createStars();
        loadThemePreferences();
        setTimeout(hideInitialLoader, 1500);
    });

    (function lazyLoadingOptimization() {
        function applyLazyLoadingAttributes(root) {
            const scope = root && root.querySelectorAll ? root : document;
            scope.querySelectorAll('img').forEach(img => {
                if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
            });
        }

        function watchDynamicImages() {
            applyLazyLoadingAttributes(document);
            const target = document.getElementById('itemContainer') || document.body;
            if (!target || typeof MutationObserver === 'undefined') return;
            const observer = new MutationObserver(mutations => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (!node || node.nodeType !== 1) continue;
                        if (node.tagName === 'IMG') {
                            applyLazyLoadingAttributes(node.parentNode || document);
                        } else {
                            applyLazyLoadingAttributes(node);
                        }
                    }
                }
            });
            observer.observe(target, { childList: true, subtree: true });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', watchDynamicImages);
        } else {
            watchDynamicImages();
        }
    })();
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            const swCode =
                `const CACHE_NAME='marketplace-v1',IMAGE_CACHE_NAME='marketplace-images-v1'; const IMAGE_URL_PATTERN=/\\.(jpg|jpeg|png|webp|avif|gif|svg)(\\?.*)?$/i; self.addEventListener('install',e=>self.skipWaiting()); self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==IMAGE_CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))); self.addEventListener('fetch',e=>{const r=e.request; if(r.method!=='GET')return; const u=new URL(r.url); const isImage=r.destination==='image'||IMAGE_URL_PATTERN.test(u.pathname); if(isImage){e.respondWith(caches.open(IMAGE_CACHE_NAME).then(c=>c.match(r).then(cached=>cached||fetch(r).then(net=>{if(!net||net.status!==200)return net; const clone=net.clone(); c.put(r,clone); return net;}).catch(()=>new Response('Offline',{status:503})))));}});`;
            const blob = new Blob([swCode], { type: 'application/javascript' });
            const swUrl = URL.createObjectURL(blob);
            navigator.serviceWorker.register(swUrl).then(() => URL.revokeObjectURL(swUrl)).catch(() => {});
        });
    }
})();