document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // INITIALIZE LUCIDE ICONS
  // ==========================================
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // ==========================================
  // PAGE LOADER FADE OUT
  // ==========================================
  const pageLoader = document.getElementById('pageLoader');
  window.addEventListener('load', () => {
    setTimeout(() => {
      pageLoader.classList.add('fade-out');
    }, 500); // Small delay for visual pleasure
  });
  // Fallback in case window load takes too long
  setTimeout(() => {
    if (pageLoader && !pageLoader.classList.contains('fade-out')) {
      pageLoader.classList.add('fade-out');
    }
  }, 3000);

  // ==========================================
  // STICKY HEADER & BACK TO TOP BUTTON
  // ==========================================
  const header = document.getElementById('header');
  const backToTop = document.getElementById('backToTop');
  const scrollThreshold = 100;

  window.addEventListener('scroll', () => {
    if (window.scrollY > scrollThreshold) {
      header.classList.add('scrolled');
      if (backToTop) backToTop.classList.add('active');
    } else {
      header.classList.remove('scrolled');
      if (backToTop) backToTop.classList.remove('active');
    }
  });

  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

  // ==========================================
  // MOBILE MENU OVERLAY TOGGLE
  // ==========================================
  const menuToggle = document.getElementById('menuToggle');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link');

  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('open');
      navMenu.classList.toggle('open');
    });

    // Close menu when clicking links
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('open');
        navMenu.classList.remove('open');
      });
    });
  }

  // ==========================================
  // SCROLL REVEAL EFFECTS (IntersectionObserver)
  // ==========================================
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
  
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-active');
          if (entry.target.classList.contains('reveal-left')) {
            entry.target.classList.add('reveal-active-left');
          }
          if (entry.target.classList.contains('reveal-right')) {
            entry.target.classList.add('reveal-active-right');
          }
          if (entry.target.classList.contains('reveal-scale')) {
            entry.target.classList.add('reveal-active-scale');
          }
          observer.unobserve(entry.target); // Trigger once
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(el => revealObserver.observe(el));
  } else {
    // Fallback if IntersectionObserver not supported
    revealElements.forEach(el => {
      el.classList.add('reveal-active');
      el.classList.remove('reveal', 'reveal-left', 'reveal-right', 'reveal-scale');
    });
  }

  // ==========================================
  // SCROLL SPY ACTIVE NAV LINK
  // ==========================================
  const sections = document.querySelectorAll('section[id]');
  
  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPos = window.scrollY + 120; // Offset for header height

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });

  // ==========================================
  // 360° VIRTUAL TOUR SIMULATION
  // ==========================================
  const vtViewer = document.getElementById('vtViewer');
  const vtOverlay = document.getElementById('vtOverlay');
  const vtOverlayBtn = document.getElementById('vtOverlayBtn');
  const vtStartBtn = document.getElementById('vtStartBtn');
  const vtLeft = document.getElementById('vtLeft');
  const vtRight = document.getElementById('vtRight');
  const vtReset = document.getElementById('vtReset');

  let isDragging = false;
  let startX = 0;
  let currentBgPosX = 0;
  let targetBgPosX = 0;
  const rotationSensitivity = 0.5; // Drag speed modifier
  const transitionSpeed = 0.15; // Smooth interpolation factor

  // Initialize background position
  if (vtViewer) {
    vtViewer.style.backgroundPositionX = '0px';
  }

  // Dismiss overlay helper
  function dismissOverlay() {
    if (vtOverlay && !vtOverlay.classList.contains('hide')) {
      vtOverlay.classList.add('hide');
    }
  }

  if (vtOverlayBtn) vtOverlayBtn.addEventListener('click', dismissOverlay);
  if (vtStartBtn) {
    vtStartBtn.addEventListener('click', () => {
      dismissOverlay();
      vtViewer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Viewport dragging math
  function startDrag(e) {
    dismissOverlay();
    isDragging = true;
    startX = e.pageX || e.touches[0].pageX;
    // Parse current X position
    const bgPosString = vtViewer.style.backgroundPositionX || '0px';
    currentBgPosX = parseFloat(bgPosString);
    vtViewer.style.cursor = 'grabbing';
  }

  function doDrag(e) {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX || e.touches[0].pageX;
    const dx = x - startX;
    targetBgPosX = currentBgPosX + (dx * rotationSensitivity);
    vtViewer.style.backgroundPositionX = `${targetBgPosX}px`;
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    vtViewer.style.cursor = 'grab';
  }

  if (vtViewer) {
    // Mouse events
    vtViewer.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', endDrag);

    // Touch events
    vtViewer.addEventListener('touchstart', startDrag, { passive: true });
    vtViewer.addEventListener('touchmove', doDrag, { passive: false });
    vtViewer.addEventListener('touchend', endDrag);

    // Button controls
    vtLeft.addEventListener('click', () => {
      dismissOverlay();
      const current = parseFloat(vtViewer.style.backgroundPositionX) || 0;
      vtViewer.style.backgroundPositionX = `${current - 120}px`;
    });

    vtRight.addEventListener('click', () => {
      dismissOverlay();
      const current = parseFloat(vtViewer.style.backgroundPositionX) || 0;
      vtViewer.style.backgroundPositionX = `${current + 120}px`;
    });

    vtReset.addEventListener('click', () => {
      dismissOverlay();
      vtViewer.style.backgroundPositionX = '0px';
    });
  }

  // ==========================================
  // WEEKLY FOOD MENU TAB SWITCHER
  // ==========================================
  const foodTabBtns = document.querySelectorAll('.food-tab-btn');
  const foodMenuContents = document.querySelectorAll('.food-menu-content');

  foodTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedDay = btn.getAttribute('data-day');
      
      // Toggle button active classes
      foodTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle menu container visible classes
      foodMenuContents.forEach(menu => {
        menu.classList.remove('active');
        if (menu.getAttribute('id') === selectedDay) {
          menu.classList.add('active');
        }
      });
    });
  });

  // ==========================================
  // INTERACTIVE GALLERY SYSTEM (Masonry & Lightbox)
  // ==========================================
  const filterBtns = document.querySelectorAll('.gallery-filter-btn');
  const galleryItems = document.querySelectorAll('.gallery-item');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  let activeGalleryList = []; // Keeps track of currently filtered images
  let currentLightboxIndex = 0;

  // Filter logic
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filterValue = btn.getAttribute('data-filter');

      // Sync button states
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Filter gallery elements
      galleryItems.forEach(item => {
        const itemCategory = item.getAttribute('data-category');
        if (filterValue === 'all' || itemCategory === filterValue) {
          item.style.display = 'block';
          // Force layout recalculation for columns
          setTimeout(() => item.style.opacity = '1', 50);
        } else {
          item.style.opacity = '0';
          item.style.display = 'none';
        }
      });
      rebuildActiveGalleryList();
    });
  });

  function rebuildActiveGalleryList() {
    activeGalleryList = [];
    galleryItems.forEach(item => {
      if (item.style.display !== 'none') {
        const img = item.querySelector('img');
        const caption = item.querySelector('.gallery-info h4');
        activeGalleryList.push({
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt'),
          title: caption ? caption.innerText : 'Dolphin PG Room Details'
        });
      }
    });
  }

  // Open Lightbox
  galleryItems.forEach(item => {
    item.addEventListener('click', () => {
      rebuildActiveGalleryList();
      const clickedImgSrc = item.querySelector('img').getAttribute('src');
      
      // Find matches index
      currentLightboxIndex = activeGalleryList.findIndex(x => x.src === clickedImgSrc);
      if (currentLightboxIndex === -1) currentLightboxIndex = 0;
      
      openLightbox();
    });
  });

  function openLightbox() {
    const data = activeGalleryList[currentLightboxIndex];
    if (!data) return;

    lightboxImg.setAttribute('src', data.src);
    lightboxImg.setAttribute('alt', data.alt);
    lightboxCaption.innerText = data.title;
    
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden'; // Lock background scroll
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = ''; // Release scroll
  }

  function nextLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex + 1) % activeGalleryList.length;
    openLightbox();
  }

  function prevLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex - 1 + activeGalleryList.length) % activeGalleryList.length;
    openLightbox();
  }

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxNext) lightboxNext.addEventListener('click', nextLightboxImage);
  if (lightboxPrev) lightboxPrev.addEventListener('click', prevLightboxImage);

  // Close lightbox on clicking dark backdrop
  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.classList.contains('lightbox-content-wrapper')) {
        closeLightbox();
      }
    });
  }

  // Initialize list
  rebuildActiveGalleryList();

  // ==========================================
  // TESTIMONIAL REVIEW SLIDER
  // ==========================================
  const reviewsSlider = document.getElementById('reviewsSlider');
  const reviewSlides = document.querySelectorAll('.review-slide');
  const slidePrev = document.getElementById('slidePrev');
  const slideNext = document.getElementById('slideNext');
  const sliderDotsContainer = document.getElementById('sliderDots');

  let currentSlide = 0;
  let slideInterval = null;
  const slideDuration = 5000; // 5 seconds autoplay

  // Create dot indicators
  if (reviewsSlider && reviewSlides.length > 0) {
    reviewSlides.forEach((_, idx) => {
      const dot = document.createElement('div');
      dot.classList.add('slider-dot');
      if (idx === 0) dot.classList.add('active');
      dot.addEventListener('click', () => {
        goToSlide(idx);
        resetAutoplay();
      });
      sliderDotsContainer.appendChild(dot);
    });

    function updateSliderPosition() {
      reviewsSlider.style.transform = `translateX(-${currentSlide * 100}%)`;
      
      // Update dot active classes
      const dots = sliderDotsContainer.querySelectorAll('.slider-dot');
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentSlide);
      });
    }

    function goToSlide(index) {
      currentSlide = (index + reviewSlides.length) % reviewSlides.length;
      updateSliderPosition();
    }

    function nextSlide() {
      goToSlide(currentSlide + 1);
    }

    function prevSlide() {
      goToSlide(currentSlide - 1);
    }

    slidePrev.addEventListener('click', () => {
      prevSlide();
      resetAutoplay();
    });

    slideNext.addEventListener('click', () => {
      nextSlide();
      resetAutoplay();
    });

    // Touch Swipe Support for Testimonials Slider
    let touchStartX = 0;
    let touchEndX = 0;

    reviewsSlider.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    reviewsSlider.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    }, { passive: true });

    function handleSwipe() {
      const swipeDistance = touchEndX - touchStartX;
      if (swipeDistance < -50) {
        nextSlide();
        resetAutoplay();
      } else if (swipeDistance > 50) {
        prevSlide();
        resetAutoplay();
      }
    }

    // Autoplay setup
    function startAutoplay() {
      slideInterval = setInterval(nextSlide, slideDuration);
    }

    function resetAutoplay() {
      clearInterval(slideInterval);
      startAutoplay();
    }

    startAutoplay();

    // Pause on hover
    reviewsSlider.addEventListener('mouseenter', () => clearInterval(slideInterval));
    reviewsSlider.addEventListener('mouseleave', startAutoplay);
  }

  // ==========================================
  // STATISTICS ANIMATED COUNTERS
  // ==========================================
  const counterElements = document.querySelectorAll('.counter');
  let countersAnimated = false;

  function animateCounters() {
    counterElements.forEach(counter => {
      const targetStr = counter.getAttribute('data-target');
      const isFloat = targetStr.includes('.');
      const target = parseFloat(targetStr);
      const increment = target / 100;
      let currentVal = 0;

      const updateCount = () => {
        currentVal += increment;
        if (currentVal < target) {
          if (isFloat) {
            counter.innerText = currentVal.toFixed(1) + '★';
          } else {
            counter.innerText = Math.ceil(currentVal) + (targetStr.includes('+') || target === 300 ? '+' : '');
          }
          setTimeout(updateCount, 15);
        } else {
          counter.innerText = targetStr; // Snap to final formatted target
        }
      };
      updateCount();
    });
  }

  // Intersection observer for counters block
  const statsSection = document.querySelector('.stats');
  if (statsSection && 'IntersectionObserver' in window) {
    const statsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !countersAnimated) {
        animateCounters();
        countersAnimated = true;
      }
    }, { threshold: 0.2 });
    statsObserver.observe(statsSection);
  } else {
    // Fallback
    animateCounters();
  }

  // ==========================================
  // FAQ ACCORDIONS (Smooth height)
  // ==========================================
  const faqHeaders = document.querySelectorAll('.faq-header');

  faqHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const parent = header.parentElement;
      const body = parent.querySelector('.faq-body');
      const isActive = parent.classList.contains('active');

      // Close all other accordions
      document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
        item.querySelector('.faq-body').style.maxHeight = null;
      });

      // Toggle current accordion
      if (!isActive) {
        parent.classList.add('active');
        body.style.maxHeight = body.scrollHeight + 'px';
      }
    });
  });

  // ==========================================
  // BOOK VISIT POPUP MODAL & FORMS
  // ==========================================
  const bookingModal = document.getElementById('bookingModal');
  const openModalBtns = document.querySelectorAll('.open-booking-btn');
  const modalClose = document.getElementById('modalClose');
  const bookingForm = document.getElementById('bookingForm');
  const modalSuccessState = document.getElementById('modalSuccessState');
  const successCloseBtn = document.getElementById('successCloseBtn');

  function openModal() {
    bookingModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Auto-populate tomorrow's date in visit form
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateInput = document.getElementById('bookDate');
    if (dateInput) {
      dateInput.value = tomorrow.toISOString().split('T')[0];
    }
  }

  function closeModal() {
    bookingModal.classList.remove('active');
    document.body.style.overflow = '';
    // Reset forms states
    setTimeout(() => {
      bookingForm.style.display = 'block';
      modalSuccessState.style.display = 'none';
      bookingForm.reset();
    }, 400);
  }

  openModalBtns.forEach(btn => btn.addEventListener('click', openModal));
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (successCloseBtn) successCloseBtn.addEventListener('click', closeModal);

  // Close modal on outside click
  if (bookingModal) {
    bookingModal.addEventListener('click', (e) => {
      if (e.target === bookingModal) {
        closeModal();
      }
    });
  }

  // Handle Booking Form Submission
  if (bookingForm) {
    bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('bookName').value;
      const phone = document.getElementById('bookPhone').value;
      const date = document.getElementById('bookDate').value;
      const slot = document.getElementById('bookSlot').value;
      const room = document.getElementById('bookRoom').value;

      // Animate to success state
      bookingForm.style.display = 'none';
      modalSuccessState.style.display = 'flex';

      // Auto-trigger WhatsApp messaging link after 3 seconds for active customer conversion
      const waMsg = `Hi! I have scheduled a visit for Dolphin PG Hostel. \n\nDetails:\nName: ${name}\nPhone: ${phone}\nDate: ${date}\nTime Slot: ${slot}\nRoom Preference: ${room} Sharing\n\nPlease confirm availability.`;
      const encodedWaMsg = encodeURIComponent(waMsg);
      
      setTimeout(() => {
        window.open(`https://wa.me/918142638659?text=${encodedWaMsg}`, '_blank');
      }, 2500);
    });
  }

  // Handle Contact Inquiry Form Submission
  const inquiryForm = document.getElementById('inquiryForm');
  if (inquiryForm) {
    inquiryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const submitBtn = inquiryForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      
      // Animate sending state
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="loader-spinner" style="width:20px; height:20px; border-width:2px; display:inline-block; margin-top:0;"></span> Sending...';
      
      setTimeout(() => {
        submitBtn.innerHTML = '<i data-lucide="check"></i> Message Sent Successfully!';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        submitBtn.style.background = 'var(--success)';
        
        setTimeout(() => {
          inquiryForm.reset();
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
          submitBtn.style.background = '';
        }, 3000);
      }, 1500);
    });
  }

  // ==========================================
  // DIGITAL BROCHURE DOWNLOADER (Simulator)
  // ==========================================
  const downloadBrochureBtn = document.getElementById('downloadBrochureBtn');
  if (downloadBrochureBtn) {
    downloadBrochureBtn.addEventListener('click', () => {
      const originalText = downloadBrochureBtn.innerHTML;
      downloadBrochureBtn.disabled = true;
      downloadBrochureBtn.innerHTML = '<span class="loader-spinner" style="width:16px; height:16px; border-width:2px; display:inline-block; margin-top:0; border-top-color:#004d47"></span> Generating PDF...';

      setTimeout(() => {
        downloadBrochureBtn.innerHTML = '<i data-lucide="check"></i> Brochure Downloaded!';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        downloadBrochureBtn.style.background = 'var(--primary-light)';
        downloadBrochureBtn.style.color = 'var(--primary-deep)';
        
        // Trigger simulated file download
        const link = document.createElement('a');
        link.href = '#'; // In a real app, this links to the PDF asset file path
        link.setAttribute('download', 'Dolphin_PG_Hostel_Brochure.pdf');
        
        // Create an alert notification for user
        alert("Success! Dolphin PG Hostel digital brochure PDF has been generated and downloaded to your device.");

        setTimeout(() => {
          downloadBrochureBtn.disabled = false;
          downloadBrochureBtn.innerHTML = originalText;
          downloadBrochureBtn.style.background = '';
          downloadBrochureBtn.style.color = '';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 4000);
      }, 2000);
    });
  }

  // ==========================================
  // DYNAMIC COPYRIGHT YEAR
  // ==========================================
  const copyrightYear = document.getElementById('copyrightYear');
  if (copyrightYear) {
    copyrightYear.innerText = new Date().getFullYear();
  }

});
