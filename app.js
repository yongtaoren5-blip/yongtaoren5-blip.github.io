// 1. 初始化3D核心对象
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeaeae);

// 相机初始化
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// 渲染器初始化
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.physicallyCorrectLights = true;
renderer.toneMappingExposure = 1.2;

// 视角控制器初始化（核心：OrbitControls默认是摄像机绕目标点旋转）
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 2;
controls.maxDistance = 10;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;

// 2. 全局状态定义（核心：基于球面坐标记录摄像机状态）
let model = null;
const modelPaths = {
  model1: 'static/red.glb',
  model2: 'static/your-product5.glb',
  model3: 'static/black.glb'
};
let isModelLoading = false;
const cubeGuideBtn = document.getElementById('cubeGuideBtn');

// 初始状态配置
const initialState = {
  cameraPosition: new THREE.Vector3(0, 0, 5),
  controlsTarget: new THREE.Vector3(0, 0, 0),
  modelScale: new THREE.Vector3(8, 8, 8),
  modelPosition: new THREE.Vector3(0, 0, 0),
  modelRotation: new THREE.Vector3(0, 0, 0)
};

// 自动旋转核心状态（基于球面坐标，关键修正！）
let isAutoRotating = false;
const autoRotateSpeed = 0.001; // 旋转速度（越小越慢，建议0.001~0.003）
let rotatePauseTimer = null;
const pauseDuration = 3000;
// 球面坐标：记录摄像机绕目标点的核心参数（拖拽时实时更新）
let cameraSpherical = {
  radius: 5,        // 摄像机到目标点的距离
  polarAngle: Math.PI / 2, // 极角（垂直角度，Math.PI/2=水平）
  azimuthAngle: 0    // 方位角（水平角度，自动旋转仅改这个值）
};

// 3. 窗口尺寸适配
function handleResize() {
  camera.fov = window.innerWidth / window.innerHeight < 0.6 ? 85 : 75;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
}

// 4. 灯光设置
function initLights() {
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(50, 50, 50);
  scene.add(dirLight);
  const pointLight = new THREE.PointLight(0xffffff, 0.5);
  pointLight.position.set(-5, 3, 4);
  scene.add(pointLight);
}

// 5. 模型加载函数
function loadModel(modelPath) {
  if (isModelLoading) return;
  isModelLoading = true;

  const loader = new THREE.GLTFLoader();
  loader.load(
    modelPath,
    (gltf) => {
      if (model) {
        scene.remove(model);
        model.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose();
            if (child.material) {
              Array.isArray(child.material) 
                ? child.material.forEach(mat => mat.dispose()) 
                : child.material.dispose();
            }
          }
        });
        model = null;
      }

      model = gltf.scene;
      model.position.copy(initialState.modelPosition);
      model.rotation.copy(initialState.modelRotation);
      model.scale.copy(initialState.modelScale);
      model.updateMatrixWorld(true);
      scene.add(model);
      
      // 模型加载后：更新球面坐标为初始状态，1秒后启动旋转
      updateCameraSphericalFromCurrent();
      setTimeout(() => {
        startAutoRotate();
      }, 2000);

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

// 6. 核心工具函数：从当前摄像机位置更新球面坐标（关键！）
function updateCameraSphericalFromCurrent() {
  // 计算摄像机到目标点的向量
  const offset = new THREE.Vector3();
  offset.copy(camera.position).sub(controls.target);
  
  // 将向量转换为球面坐标（核心：Three.js内置球面坐标转换）
  const spherical = new THREE.Spherical();
  spherical.setFromVector3(offset);
  
  // 同步到全局球面坐标状态（只记录需要的参数）
  cameraSpherical.radius = spherical.radius;        // 距离（拖拽时会变）
  cameraSpherical.polarAngle = spherical.phi;       // 极角（垂直角度，自动旋转固定）
  cameraSpherical.azimuthAngle = spherical.theta;   // 方位角（水平角度，自动旋转递增）
}

// 7. 自动旋转控制函数
function startAutoRotate() {
  if (isAutoRotating) return;
  isAutoRotating = true;
}

function pauseAutoRotate() {
  isAutoRotating = false;
  if (rotatePauseTimer) clearTimeout(rotatePauseTimer);
  // 3秒后恢复旋转（恢复时基于最新的球面坐标）
  rotatePauseTimer = setTimeout(() => {
    startAutoRotate();
  }, pauseDuration);
}

// 8. 重构自动旋转逻辑（基于球面坐标，绝对不会回退！）
function rotateCameraAroundModel() {
  if (!isAutoRotating || !model) return;
  
  // 核心：只递增方位角（水平角度），极角和距离保持不变
  cameraSpherical.azimuthAngle += autoRotateSpeed;
  // 超过2π（360°）后重置，避免数值过大
  if (cameraSpherical.azimuthAngle > 2 * Math.PI) {
    cameraSpherical.azimuthAngle -= 2 * Math.PI;
  }
  
  // 根据球面坐标计算摄像机新位置
  const spherical = new THREE.Spherical(
    cameraSpherical.radius,
    cameraSpherical.polarAngle,
    cameraSpherical.azimuthAngle
  );
  // 将球面坐标转回笛卡尔坐标（摄像机位置）
  camera.position.setFromSpherical(spherical).add(controls.target);
  // 摄像机始终看向目标点（模型中心）
  camera.lookAt(controls.target);
  controls.update();
}

// 9. 模型切换初始化
function initModelSwitch() {
  const buttons = document.querySelectorAll('.feature-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isModelLoading) return alert('模型正在加载中，请稍等！');
      const modelKey = btn.dataset.feature;
      const targetPath = modelPaths[modelKey];
      if (!targetPath) return alert(`未配置【${modelKey}】对应的模型路径！`);
      
      loadModel(targetPath);
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const defaultBtn = document.querySelector('.feature-btn.active');
  if (defaultBtn) {
    const defaultPath = modelPaths[defaultBtn.dataset.feature];
    defaultPath && loadModel(defaultPath);
  }
}

// 10. 控制器初始化（监听拖拽，实时更新球面坐标）
function initControlsState() {
  // 设置初始摄像机位置
  camera.position.copy(initialState.cameraPosition);
  controls.target.copy(initialState.controlsTarget);
  camera.lookAt(controls.target);
  controls.saveState();
  controls.update();
  
  // 初始化球面坐标
  updateCameraSphericalFromCurrent();
  
  // 监听拖拽事件：
  // 1. 拖拽开始：暂停旋转，更新当前球面坐标（记录拖拽起点）
  controls.addEventListener('start', () => {
    pauseAutoRotate();
    updateCameraSphericalFromCurrent();
  });
  // 2. 拖拽过程：实时更新球面坐标（确保拖拽结束后记录的是最终位置）
  controls.addEventListener('change', () => {
    updateCameraSphericalFromCurrent();
  });
  
   // 修改：初始化后延迟2秒启动自动旋转（原立即启动）
    setTimeout(() => {
      startAutoRotate();
    }, 2000); // 2000毫秒=2秒
}

// 11. 正方体旋转映射（保留原有逻辑，不影响核心旋转）
function initCubeRotationMapping() {
  if (!cubeGuideBtn) return;

  const cameraEuler = new THREE.Euler();
  const rotationSpeedRatio = 0.7;

  const updateCubeRotation = (() => {
    let timer = null;
    return () => {
      if (!timer) {
        timer = setTimeout(() => {
          cameraEuler.setFromQuaternion(camera.quaternion);
          const rotateY = -THREE.MathUtils.radToDeg(cameraEuler.y) * rotationSpeedRatio;
          const rotateX = THREE.MathUtils.radToDeg(cameraEuler.x) * rotationSpeedRatio;
          cubeGuideBtn.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`;
          timer = null;
        }, 50);
      }
    };
  })();

  controls.addEventListener('change', updateCubeRotation);

  cubeGuideBtn.addEventListener('click', () => {
    if (isModelLoading) {
      alert('模型正在加载中，请稍等！');
      return;
    }
    isAutoRotating = false;
    if (rotatePauseTimer) clearTimeout(rotatePauseTimer);
    controls.enabled = false;
    cubeGuideBtn.style.pointerEvents = 'none';

    gsap.to(camera.position, {
      x: initialState.cameraPosition.x,
      y: initialState.cameraPosition.y,
      z: initialState.cameraPosition.z,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        controls.target.copy(initialState.controlsTarget);
        camera.lookAt(controls.target);
        camera.updateProjectionMatrix();
        controls.update();
      },
      onComplete: () => {
        if (model) {
          model.position.copy(initialState.modelPosition);
          model.rotation.copy(initialState.modelRotation);
          model.scale.copy(initialState.modelScale);
          model.updateMatrixWorld(true);
        }

        controls.reset();
        controls.enabled = true;
        cubeGuideBtn.style.pointerEvents = 'auto';
        cubeGuideBtn.style.transform = 'rotateY(0deg) rotateX(0deg)';
        
        // 重置后更新球面坐标，从初始角度重新旋转
        updateCameraSphericalFromCurrent();
        renderer.render(scene, camera);
      }
    });
    
    setTimeout(() => {
      startAutoRotate();
    }, 2000);
  });
}

// 12. 渲染循环
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  rotateCameraAroundModel(); // 执行自动旋转
  renderer.render(scene, camera);
}

// 13. 初始化入口
function init() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.getElementById('3d-container').appendChild(renderer.domElement);

  initLights();
  initModelSwitch();
  initControlsState();
  initCubeRotationMapping();

  window.addEventListener('resize', handleResize);
  handleResize();

  animate();
}

init();