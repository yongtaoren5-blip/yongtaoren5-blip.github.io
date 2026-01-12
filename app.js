// 1. 初始化3D核心对象
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeaeae);

// 相机初始化（成像参数：视角75°、宽高比、近/远裁剪面）
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// 渲染器初始化（抗锯齿+色彩校正）
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.physicallyCorrectLights = true;
renderer.toneMappingExposure = 1.2;

// 视角控制器初始化（轨道控制器）
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // 阻尼效果（平滑拖拽）
controls.dampingFactor = 0.05;
controls.minDistance = 2;      // 相机最小距离
controls.maxDistance = 10;     // 相机最大距离
controls.minPolarAngle = 0;    // 垂直旋转最小角度
controls.maxPolarAngle = Math.PI; // 垂直旋转最大角度

// 2. 全局状态定义（核心：初始状态基准值）
let model = null; // 当前加载的3D模型
const modelPaths = { // 模型路径映射
  model1: 'static/red.glb',
  model2: 'static/your-product5.glb',
  model3: 'static/black.glb'
};
let isModelLoading = false; // 模型加载状态锁
const cubeGuideBtn = document.getElementById('cubeGuideBtn'); // 正方体按钮DOM

// 初始状态配置（重置基准：相机/控制器/模型）
const initialState = {
  cameraPosition: new THREE.Vector3(0, 0, 5),    // 相机初始位置
  controlsTarget: new THREE.Vector3(0, 0, 0),    // 控制器目标点
  modelScale: new THREE.Vector3(8, 8, 8),        // 模型初始缩放
  modelPosition: new THREE.Vector3(0, 0, 0),     // 模型初始位置
  modelRotation: new THREE.Vector3(0, 0, 0)      // 模型初始旋转
};

// 新增：节流函数（限制函数触发频率，减少渲染压力）
function throttle(fn, delay = 50) {
  let timer = null;
  return function (...args) {
    if (!timer) {
      timer = setTimeout(() => {
        fn.apply(this, args);
        timer = null;
      }, delay);
    }
  };
}

// 3. 窗口尺寸适配函数（响应式调整）
function handleResize() {
  // 适配不同屏幕宽高比的相机视角
  camera.fov = window.innerWidth / window.innerHeight < 0.6 ? 85 : 75;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix(); // 强制更新相机投影矩阵
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio); // 适配高清屏
}

// 4. 灯光设置函数（增强模型视觉效果）
function initLights() {
  // 环境光（基础照明）
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);
  // 方向光（模拟太阳光）
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(50, 50, 50);
  scene.add(dirLight);
  // 点光源（局部补光）
  const pointLight = new THREE.PointLight(0xffffff, 0.5);
  pointLight.position.set(-5, 3, 4);
  scene.add(pointLight);
}

// 5. 模型加载函数（修复：加载后强制应用初始状态）
function loadModel(modelPath) {
  if (isModelLoading) return; // 加载中禁止重复操作
  isModelLoading = true;

  const loader = new THREE.GLTFLoader();
  loader.load(
    modelPath,
    (gltf) => {
      // 移除旧模型（释放内存）
      if (model) {
        scene.remove(model);
        model.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose(); // 释放几何体内存
            // 释放材质内存
            if (child.material) {
              Array.isArray(child.material) 
                ? child.material.forEach(mat => mat.dispose()) 
                : child.material.dispose();
            }
          }
        });
        model = null;
      }

      // 添加新模型（强制应用初始状态）
      model = gltf.scene;
      model.position.copy(initialState.modelPosition); // 初始位置
      model.rotation.copy(initialState.modelRotation); // 初始旋转
      model.scale.copy(initialState.modelScale);       // 初始缩放
      model.updateMatrixWorld(true); // 强制更新模型矩阵（关键：避免缩放错位）
      scene.add(model);
      isModelLoading = false;
    },
    (xhr) => console.log(`${(xhr.loaded / xhr.total * 100).toFixed(1)}% 加载完成`),
    (error) => {
      console.error('模型加载失败:', error);
      isModelLoading = false;
      alert(`模型加载失败：${error.message}`);
    }
  );
}

// 6. 模型切换函数（按钮交互）
function initModelSwitch() {
  const buttons = document.querySelectorAll('.feature-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isModelLoading) return alert('模型正在加载中，请稍等！');
      const modelKey = btn.dataset.feature;
      const targetPath = modelPaths[modelKey];
      if (!targetPath) return alert(`未配置【${modelKey}】对应的模型路径！`);
      
      loadModel(targetPath);
      // 切换按钮激活状态
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 初始化默认模型
  const defaultBtn = document.querySelector('.feature-btn.active');
  if (defaultBtn) {
    const defaultPath = modelPaths[defaultBtn.dataset.feature];
    defaultPath && loadModel(defaultPath);
  }
}

// 7. 控制器初始状态保存函数（修复：避免reset()错位）
function initControlsState() {
  // 手动设置控制器+相机初始状态
  controls.target.copy(initialState.controlsTarget);
  camera.position.copy(initialState.cameraPosition);
  camera.lookAt(initialState.controlsTarget);
  controls.saveState(); // 保存初始状态（关键：后续reset()基于此）
  controls.update();    // 强制更新控制器
}

// 8. 核心：正方体旋转映射 + 单击重置模型（优化版：节流+降速）
function initCubeRotationMapping() {
  if (!cubeGuideBtn) return;

  // 新增：缓存欧拉角实例（减少重复创建，降低性能消耗）
  const cameraEuler = new THREE.Euler();
  // 旋转速度比例（0~1之间，越小越慢，建议0.5~0.8）
  const rotationSpeedRatio = 0.7;

  // 优化：节流后的旋转更新逻辑（每50ms触发一次，减少渲染压力）
  const updateCubeRotation = throttle(() => {
    // 提取相机旋转四元数 → 转换为欧拉角（角度制）
    cameraEuler.setFromQuaternion(camera.quaternion);
    // 降低旋转速度：乘以比例系数
    const rotateY = -THREE.MathUtils.radToDeg(cameraEuler.y) * rotationSpeedRatio;
    const rotateX = THREE.MathUtils.radToDeg(cameraEuler.x) * rotationSpeedRatio;
    // 映射到正方体CSS旋转
    cubeGuideBtn.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`;
  }, 50); // 节流间隔：50ms（可根据需求调整，越大越省性能）

  // 控制器变化时，调用节流后的更新函数
  controls.addEventListener('change', updateCubeRotation);

  // 单击正方体按钮：重置模型/相机到初始状态
  cubeGuideBtn.addEventListener('click', () => {
    if (isModelLoading) {
      alert('模型正在加载中，请稍等！');
      return;
    }

    // 禁用控制器+按钮（防止动画过程中操作干扰）
    controls.enabled = false;
    cubeGuideBtn.style.pointerEvents = 'none';

    // 平滑重置相机位置（GSAP动画）
    gsap.to(camera.position, {
      x: initialState.cameraPosition.x,
      y: initialState.cameraPosition.y,
      z: initialState.cameraPosition.z,
      duration: 0.5,        // 动画时长0.5秒
      ease: 'power2.out',   // 缓动效果（平滑过渡）
      onUpdate: () => {
        // 实时同步控制器目标+相机朝向
        controls.target.copy(initialState.controlsTarget);
        camera.lookAt(initialState.controlsTarget);
        camera.updateProjectionMatrix(); // 强制更新相机投影
        controls.update();               // 实时更新控制器
      },
      onComplete: () => {
        // 1. 重置模型到初始状态
        if (model) {
          model.position.copy(initialState.modelPosition);
          model.rotation.copy(initialState.modelRotation);
          model.scale.copy(initialState.modelScale);
          model.updateMatrixWorld(true); // 强制更新模型矩阵（关键）
        }

        // 2. 恢复控制器状态
        controls.reset(); // 恢复到initControlsState保存的初始状态
        controls.enabled = true;
        cubeGuideBtn.style.pointerEvents = 'auto'; // 恢复按钮点击

        // 3. 重置正方体旋转样式
        cubeGuideBtn.style.transform = 'rotateY(0deg) rotateX(0deg)';

        // 4. 强制渲染场景（确保所有修改生效）
        renderer.render(scene, camera);
      }
    });
  });
}

// 9. 渲染循环（持续更新3D场景）
function animate() {
  requestAnimationFrame(animate);
  controls.update(); // 控制器阻尼效果需要实时更新
  renderer.render(scene, camera); // 渲染场景
}

// 10. 初始化入口函数（整合所有功能）
function init() {
  // 渲染器挂载到页面
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.getElementById('3d-container').appendChild(renderer.domElement);

  // 初始化功能模块
  initLights();            // 灯光
  initModelSwitch();       // 模型切换
  initControlsState();     // 控制器初始状态
  initCubeRotationMapping(); // 正方体旋转+重置

  // 窗口尺寸监听
  window.addEventListener('resize', handleResize);
  handleResize(); // 首次执行适配

  // 启动渲染循环
  animate();
}

// 执行初始化
init();