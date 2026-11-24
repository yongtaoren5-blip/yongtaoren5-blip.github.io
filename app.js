// 根目录app.js - 修复阴影响应+旋转无闪烁
let windowRenderInstances = new Map();
let modelCache = new Map();
let isLoadingBatch = false;
let observer = null;

// 模型配置：降低速度，增加缓冲
const modelConfig = {
  red: { path: 'static/u160.glb', scale: 8, rotateSpeed: 0.0003, maxRotate: Math.PI / 4 }, // 更慢速度
  black: { path: 'static/black.glb', scale: 8, rotateSpeed: 0.0003, maxRotate: Math.PI / 4 },
  product5: { path: 'static/your-product5.glb', scale: 8, rotateSpeed: 0.0003, maxRotate: Math.PI / 4 }
};

// ========== 初始化窗口渲染 ==========
function initWindowRender(container) {
  const modelKey = container.dataset.model;
  const renderContainer = container.querySelector('.render-container');
  const rect = container.getBoundingClientRect();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(75, rect.width / rect.height, 0.1, 1000);
  camera.position.set(0, 0, 5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(rect.width, rect.height);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderContainer.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(3, 3, 5);
  scene.add(ambientLight, dirLight);

  // 实例：移除硬重置，增加缓冲角度
  const instance = {
    scene, camera, renderer, model: null,
    rotateAngle: 0,
    rotateDir: -1, // 初始反向（逆时针）
    isActive: false,
    container: container,
    bufferAngle: 0.01 // 缓冲角度，避免卡停
  };
  windowRenderInstances.set(modelKey, instance);

  return modelKey;
}

// ========== 绑定点击事件 ==========
function bindClickEvents() {
  document.querySelectorAll('.embed-container').forEach(container => {
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetUrl = container.dataset.target;
      if (targetUrl) {
        window.location.href = targetUrl;
      } else {
        alert('未配置跳转路径');
      }
    });
  });
}
// 鼠标进入 - 激活窗口
    container.addEventListener('mouseenter', () => {
      activateContainer(container);
    });

    // 鼠标离开 - 取消激活
    container.addEventListener('mouseleave', () => {
      deactivateContainer(container);
    });

    // 移动端触摸开始 - 激活窗口
    container.addEventListener('touchstart', (e) => {
      e.preventDefault(); // 防止触摸事件冒泡
      activateContainer(container);
    });

    // 移动端触摸结束 - 取消激活
    container.addEventListener('touchend', (e) => {
      e.preventDefault();
      deactivateContainer(container);
    });
  });
}

// 激活窗口函数
function activateContainer(container) {
  const modelKey = container.dataset.model;
  const instance = windowRenderInstances.get(modelKey);
  if (!instance) return;

  container.classList.add('active');
  instance.isActive = true;
}

// 取消激活窗口函数
function deactivateContainer(container) {
  const modelKey = container.dataset.model;
  const instance = windowRenderInstances.get(modelKey);
  if (!instance) return;

  container.classList.remove('active');
  instance.isActive = false;
}

// 修改初始化函数
document.addEventListener('DOMContentLoaded', () => {
  bindEvents(); // 改为新的事件绑定函数
  batchLoadAllModels();
  // 移除交叉观察器初始化
  window.addEventListener('resize', handleWindowResize);

  document.body.addEventListener('touchmove', (e) => {}, { passive: true });
});


  // 重新监听所有窗口，确保无遗漏
  document.querySelectorAll('.embed-container').forEach(container => {
    observer.observe(container);
  });
}

// ========== 加载模型 ==========
function loadSingleModel(modelKey) {
  return new Promise((resolve, reject) => {
    const config = modelConfig[modelKey];
    if (!config) {
      reject(`模型配置不存在：${modelKey}`);
      return;
    }

    if (modelCache.has(modelKey)) {
      const model = modelCache.get(modelKey).clone();
      model.scale.set(config.scale, config.scale, config.scale);
      model.position.set(0, 0, 0);
      resolve(model);
      return;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(
      config.path,
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(config.scale, config.scale, config.scale);
        model.position.set(0, 0, 0);
        modelCache.set(modelKey, model);
        resolve(model.clone());
      },
      (xhr) => console.log(`加载${modelKey}：${Math.round(xhr.loaded/xhr.total*100)}%`),
      (err) => reject(`模型${modelKey}加载失败：${err.message}`)
    );
  });
}

// ========== 批量加载 ==========
async function batchLoadAllModels() {
  if (isLoadingBatch) return;
  isLoadingBatch = true;

  const containers = Array.from(document.querySelectorAll('.embed-container'));
  for (const container of containers) {
    try {
      const modelKey = initWindowRender(container);
      const model = await loadSingleModel(modelKey);
      const instance = windowRenderInstances.get(modelKey);
      instance.model = model;
      instance.scene.add(model);
    } catch (err) {
      console.error(err);
      alert(err);
    }
  }

  isLoadingBatch = false;
  animateAllWindows();
}

// ========== 核心：无闪烁旋转逻辑（平滑循环） ==========
function animateAllWindows() {
  requestAnimationFrame(animateAllWindows);

  windowRenderInstances.forEach((instance) => {
    const { scene, camera, renderer, model, rotateAngle, rotateDir, isActive, container, bufferAngle } = instance;
    const config = modelConfig[container.dataset.model];

    if (!model) return;

    let newAngle = rotateAngle;

    // 激活态：平滑循环旋转，无跳跃
    if (isActive) {
      newAngle += config.rotateSpeed * rotateDir;

      // 关键修复：到达最大角度时，平滑反向（无硬重置）
      if (newAngle >= config.maxRotate) {
        instance.rotateDir = -1; // 反向（顺时针）
        newAngle = config.maxRotate - bufferAngle; // 缓冲，避免跳变
      } else if (newAngle <= -config.maxRotate) {
        instance.rotateDir = 1; // 反向（逆时针）
        newAngle = -config.maxRotate + bufferAngle; // 缓冲
      }
    } 
    // 非激活态：暂停
    else {
      newAngle = rotateAngle;
    }

    // 更新角度（无跳跃）
    instance.rotateAngle = newAngle;
    model.rotation.y = newAngle;
    renderer.render(scene, camera);
  });
}

// ========== 窗口resize ==========
function handleWindowResize() {
  windowRenderInstances.forEach((instance) => {
    const { camera, renderer, container } = instance;
    const rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
  });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  bindClickEvents();
  batchLoadAllModels();
  initIntersectionObserver(); // 确保观察者优先初始化
  window.addEventListener('resize', handleWindowResize);

  document.body.addEventListener('touchmove', (e) => {}, { passive: true });
});

// ========== 卸载清理 ==========
window.addEventListener('unload', () => {
  if (observer) observer.disconnect();
  windowRenderInstances.forEach((instance) => {
    instance.renderer.dispose();
    if (instance.model) {
      instance.model.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          Array.isArray(child.material) 
            ? child.material.forEach(mat => mat.dispose()) 
            : child.material.dispose();
        }
      });
    }
  });
  windowRenderInstances.clear();
  modelCache.clear();
});