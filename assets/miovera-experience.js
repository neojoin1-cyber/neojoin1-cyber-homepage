(function () {
  const root = document.querySelector('[data-miovera-experience]');
  if (!root) return;

  const tracks = {
    premium: {
      label: '프리미엄 소장판',
      scenes: [
        {
          image: 'assets/miovera-premium-page-01.webp',
          title: '젖은 별씨앗 지도',
          caption: '빗소리와 별빛이 만나는 첫 장면입니다. 소장판은 그림의 질감과 장면 몰입감을 먼저 보여줍니다.',
          alt: '프리미엄 소장판 1장면 시연'
        },
        {
          image: 'assets/miovera-premium-page-02.webp',
          title: '작은 문 앞의 약속',
          caption: '장면마다 주인공의 위치와 감정이 달라지고, 이야기의 긴장감이 다음 페이지로 이어집니다.',
          alt: '프리미엄 소장판 2장면 시연'
        },
        {
          image: 'assets/miovera-premium-page-03.webp',
          title: '모험이 열리는 순간',
          caption: '여기서부터는 내 아이 사진 5장으로 앱 안에서 안전하게 캐릭터를 확인한 뒤 제작합니다.',
          alt: '프리미엄 소장판 3장면 시연'
        }
      ]
    },
    free: {
      label: '무료 맛보기',
      scenes: [
        {
          image: 'assets/miovera-free-page-01.webp',
          title: '가볍게 시작하는 첫 장면',
          caption: '무료 맛보기는 부담 없이 동화 흐름을 확인하는 단계입니다. 낮은 진입 장벽을 위해 단순하게 보여줍니다.',
          alt: '무료 맛보기 1장면 시연'
        },
        {
          image: 'assets/miovera-free-page-02.webp',
          title: '짧은 이야기의 두 번째 장면',
          caption: '아이와 함께 읽어볼 수 있지만, 프리미엄 소장판처럼 장면별 깊은 연출을 모두 제공하지는 않습니다.',
          alt: '무료 맛보기 2장면 시연'
        },
        {
          image: 'assets/miovera-free-page-03.webp',
          title: '앱으로 이어지는 맛보기 끝',
          caption: '내 아이 사진으로 더 닮은 캐릭터와 소장용 동화를 만들려면 앱에서 보호자 동의 후 진행합니다.',
          alt: '무료 맛보기 3장면 시연'
        }
      ]
    }
  };

  let currentTrack = 'premium';
  let currentScene = 0;

  const trackButtons = Array.from(root.querySelectorAll('[data-track]'));
  const sceneButtons = Array.from(root.querySelectorAll('[data-scene]'));
  const stage = root.querySelector('.miovera-experience-stage');
  const image = root.querySelector('[data-stage-image]');
  const kicker = root.querySelector('[data-stage-kicker]');
  const title = root.querySelector('[data-stage-title]');
  const caption = root.querySelector('[data-stage-caption]');

  function render() {
    const track = tracks[currentTrack];
    const scene = track.scenes[currentScene];
    if (!track || !scene) return;

    stage.classList.add('is-changing');
    window.setTimeout(() => {
      image.src = scene.image;
      image.alt = scene.alt;
      kicker.textContent = `${track.label} · ${currentScene + 1}/3`;
      title.textContent = scene.title;
      caption.textContent = scene.caption;
      stage.classList.remove('is-changing');
    }, 120);

    trackButtons.forEach((button) => {
      const active = button.dataset.track === currentTrack;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    sceneButtons.forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.scene) === currentScene);
    });
  }

  trackButtons.forEach((button) => {
    button.addEventListener('click', () => {
      currentTrack = button.dataset.track;
      currentScene = 0;
      render();
    });
  });

  sceneButtons.forEach((button) => {
    button.addEventListener('click', () => {
      currentScene = Number(button.dataset.scene) || 0;
      render();
    });
  });
})();
