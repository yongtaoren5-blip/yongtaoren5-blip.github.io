// js/app.js：动态生成绿色高亮，加载底座后才显示可叠放按钮绿色标记
const defaultConfig = {
  modelPath: 'static/m146.glb',
  ambientIntensity: 1.0,
  dirIntensity: 1.0,
  modelScale: 45,
  modelYPos: 0,
  cameraPos: [0, 0, 5],
  autoRotateSpeed: 0.001,
  featureModels: {
    model1: 'static/m146.glb',
    model2: 'static/m146.glb',
    model3: 'static/m146e.glb'
  },
  icu:{
    scale:45,
    offsetX:0,
    offsetY:0,
    offsetZ:0,
    featureModels:{}
  }
};

(function injectIcuCss(){
  const style = document.createElement('style');
  style.textContent = `
    /* 选中ICU按钮：外圈亮条 + 外发光，让选中状态更醒目
       用 outline 而不用 box-shadow，避免和绿色可叠放的 box-shadow 互相覆盖 */
    .icu-sub-btn.active-icu {
      transform: scale(1.12);
      background:rgba(255,255,255,0.28);
      outline: 2px solid rgba(255,255,255,0.85);
      outline-offset: 2px;
      filter: drop-shadow(0 0 6px rgba(255,255,255,0.75));
      transition: transform 0.2s ease, background 0.2s ease, outline 0.2s ease, filter 0.2s ease;
    }
    .icu-sub-btn.icu-stack-target {
      box-shadow: 0 0 0 1px #72ff9a, inset 0 0 8px rgba(114,255,154,0.35);
    }
  `;
  document.head.appendChild(style);
})();

const config = Object.assign({}, defaultConfig, window.PAGE_CONFIG || {});
config.icu = Object.assign({}, defaultConfig.icu, window.PAGE_CONFIG?.icu || {});
console.log("ICU配置读取：", config.icu);

// ========== 模型缓存：同一路径只下载+解析一次 ==========
// three.js 默认关闭 Cache，同一文件每次点击都会重新请求；打开后同路径不再重复下载，省流量
if (typeof THREE.Cache !== 'undefined') THREE.Cache.enabled = true;

// 已解析过的 GLTF 原型场景（按路径保存，永不直接加入场景，只作为克隆模板）
const gltfSceneCache = new Map();

/**
 * 克隆场景并为每个 mesh 复制独立材质
 * 这样每个 ICU 实例的透明度动画互不污染，也不会改坏缓存原型
 */
function cloneSceneWithOwnMaterials(srcScene){
  const cloned = srcScene.clone(true);
  cloned.traverse(node=>{
    if(node.isMesh && node.material){
      const list = Array.isArray(node.material) ? node.material : [node.material];
      const copies = list.map(m=>{
        const c = m.clone();
        c.opacity = 1;
        c.transparent = false;
        return c;
      });
      node.material = Array.isArray(node.material) ? copies : copies[0];
    }
  });
  return cloned;
}

/**
 * 带缓存的 GLTF 加载
 * 命中缓存：不再下载、不再解析，直接克隆一份
 * 未命中：正常加载，把原型存进缓存，本次返回克隆
 */
function loadGltfCached(path, onLoad, onProgress, onError){
  const cached = gltfSceneCache.get(path);
  if(cached){
    console.log("命中模型缓存，跳过下载：", path);
    onLoad({ scene: cloneSceneWithOwnMaterials(cached) });
    return;
  }
  const loader = new THREE.GLTFLoader();
  loader.load(path, (gltf)=>{
    // 带骨骼动画的模型不适合直接 clone 复用，跳过缓存
    let hasSkinned = false;
    gltf.scene.traverse(n=>{ if(n.isSkinnedMesh) hasSkinned = true; });
    if(!hasSkinned){
      gltfSceneCache.set(path, gltf.scene);
    }
    onLoad({ scene: cloneSceneWithOwnMaterials(gltf.scene) });
  }, onProgress, onError);
}

// 进度日志节流：只在 25/50/75/100% 打印，避免控制台刷屏
function makeThrottledProgress(label){
  let last = 0;
  return (xhr)=>{
    if(!xhr.total) return;
    const pct = Math.round(xhr.loaded / xhr.total * 100);
    if(pct - last >= 25 || pct === 100){
      last = pct;
      console.log(`${label} ${pct}%`);
    }
  };
}

// 读取HTML icu‑submenu上配置的ICU全局底面基准点
const icuMenuEl = document.querySelector('.icu-submenu');
const baseOrigin = new THREE.Vector3(
  Number(icuMenuEl?.dataset.icuBaseX || 0),
  Number(icuMenuEl?.dataset.icuBaseY || 0),
  Number(icuMenuEl?.dataset.icuBaseZ || 0)
);

const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeaeae);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, sortObjects: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.physicallyCorrectLights = true;
renderer.toneMappingExposure = 1.2;
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

let model = null;
let icuInstances = [];
let isModelLoading = false;
let isIcuLoading = false;
let isIcuAnimating = false;
let isAutoRotating = false;
let isResetting = false;
// ===== 自动旋转控制 =====
// 手动拖动结束后多少毫秒才恢复自动旋转（想改恢复时间就改这个数字）
const AUTO_ROTATE_RESUME_MS = 5000;
let autoRotateResumeTimer = null; // 恢复自动旋转的定时器
let isUserInteracting = false;    // 用户是否正在拖动视角
const cubeGuideBtn = document.getElementById('cubeGuideBtn');

const initialState = {
  cameraPosition: new THREE.Vector3(...config.cameraPos),
  controlsTarget: new THREE.Vector3(0, 0, 0),
  modelScale: config.modelScale,
  modelYPos: config.modelYPos
};
let cameraSpherical = {
  radius: config.cameraPos[2],
  polarAngle: Math.PI / 2,
  azimuthAngle: 0
};

// ==========工具函数============
function setModelOpacity(obj, opacity){
  if(!obj) return;
  obj.traverse((child)=>{
    if(child.isMesh && child.material){
      if(Array.isArray(child.material)){
        child.material.forEach(mat=>{
          mat.transparent = true;
          mat.opacity = opacity;
        })
      }else{
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    }
  })
}
function restoreMainModelOpacity(){
  if(model) setModelOpacity(model,1.0);
}

function setIcuGroupVisible(group, show) {
  if(!group) return;
  group.visible = show;
}

/**
 * 准备淡入：收集组内材质，先置透明并显示group，返回材质列表（去重）
 * 透明度动画交给外部同一条时间线驱动，保证和滑移同时启动
 */
function prepareIcuFadeIn(group){
  if(!group) return [];
  const mats = [];
  group.traverse(child=>{
    if(child.isMesh && child.material){
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach(m=>{ if(!mats.includes(m)) mats.push(m); });
    }
  });
  mats.forEach(m=>{
    m.transparent = true;
    m.opacity = 0;
  });
  group.visible = true;
  return mats;
}

/** 淡入结束后恢复不透明PBR渲染，避免灰模/排序异常 */
function restoreIcuOpaque(mats){
  mats.forEach(m=>{
    m.transparent = false;
    m.opacity = 1;
  });
}

/**
 * 只计算双ICU重排目标坐标，不执行位移，返回坐标对象
 */
function relayoutIcuStackGetTargetPos(){
  if(icuInstances.length !== 2) return null;
  // 编号大的在底层
  const sorted = [...icuInstances].sort((a,b)=>getIcuNum(b)-getIcuNum(a));
  const baseInst = sorted[0];
  const topInst = sorted[1];

  const baseTargetPos = baseOrigin.clone();
  // 用加载时存好的本地包围盒算高度，再乘缩放系数；不依赖模型当前是否可见/位置，稳定
  const s = config.icu.scale;
  const localHeight = baseInst.boundingBox.max.y - baseInst.boundingBox.min.y;
  const baseHeight = localHeight * s;
  const gap = 0.1;
  const topTargetY = baseTargetPos.y + baseHeight - gap;
  const topTargetPos = new THREE.Vector3(baseOrigin.x, topTargetY, baseOrigin.z);

  return { baseTargetPos, topTargetPos, baseInst, topInst };
}

/** 清除全部绿色高亮标记 */
function clearAllStackHighlight(){
  document.querySelectorAll('.icu-sub-btn.icu-stack-target').forEach(b=>{
    b.classList.remove('icu-stack-target');
  });
}

/** 根据底座icuKey，动态给允许叠放的按钮加上绿色高亮 icu‑stack‑target */
function setStackHighlightByBaseKey(baseIcuKey){
  clearAllStackHighlight();
  const btns = document.querySelectorAll('.icu-sub-btn');
  btns.forEach(btn=>{
    const allowStr = (btn.dataset.stackAllow || "").trim();
    const allowList = allowStr ? allowStr.split(',').map(s=>s.trim()) : [];
    if(allowList.includes(baseIcuKey)){
      btn.classList.add('icu-stack-target');
    }
  })
}

/**
 * 从icuKey提取数字编号，icu5 →5，icu1→1
 * @param {object} inst icu实例对象
 * @returns {number}
 */
function getIcuNum(inst){
  const m = /icu(\d+)/.exec(inst.icuKey || "");
  return m ? Number(m[1]) : 0;
}

/**
 * 清空全部ICU实例，重置按钮状态
 * @param {boolean} restoreMainOpacity 是否把主模型恢复为不透明1.0
 *        替换ICU（紧接着加载新ICU）时传 false，保持主模型半透明，避免先变全亮再压回半透明造成闪烁；
 *        收起菜单、不再加载新ICU时用默认 true，恢复主模型不透明。
 */
function clearAllIcuInstances(restoreMainOpacity = true){
  icuInstances.forEach(inst=>{
    gsap.killTweensOf(inst.group.scale);
    gsap.killTweensOf(inst.group.position);
    inst.group.scale.set(config.icu.scale, config.icu.scale, config.icu.scale);
    setIcuGroupVisible(inst.group, true);
    scene.remove(inst.group);
  });
  icuInstances = [];
  isIcuAnimating = false;
  isIcuLoading = false;
  if(restoreMainOpacity){
    restoreMainModelOpacity();
  }
  document.querySelectorAll('.icu-sub-btn').forEach(btn=>{
    btn.classList.remove('active-icu');
  });
  clearAllStackHighlight();
}
window.clearIcuModel = clearAllIcuInstances;

function initLights() {
  const ambientLight = new THREE.AmbientLight(0xffffff, config.ambientIntensity);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, config.dirIntensity);
  dirLight.position.set(50, 50, 50);
  scene.add(dirLight);
}

function loadModel(path) {
  if (isModelLoading) return;
  isModelLoading = true;
  loadGltfCached(
    path,
    (gltf) => {
      if (model) scene.remove(model);
      model = gltf.scene;
      const modelBox = new THREE.Box3().setFromObject(model);
      const geoCenter = new THREE.Vector3();
      modelBox.getCenter(geoCenter);
      model.position.y = initialState.modelYPos - geoCenter.y;
      model.scale.set(initialState.modelScale, initialState.modelScale, initialState.modelScale);
      scene.add(model);
      updateCameraSphericalFromCurrent();
      // 加载完成时如果用户正在拖动，就别抢镜头，等他松手 5 秒后再自转
      if(isUserInteracting){
        scheduleResumeAutoRotate();
      }else{
        isAutoRotating = true;
      }
      isModelLoading = false;
      if(icuInstances.length>0){
        setModelOpacity(model,0.3);
      }
      console.log("主模型加载完成");
    },
    makeThrottledProgress("主模型加载"),
    (error) => {
      console.error('主模型加载失败：', error, '路径：', path);
      isModelLoading = false;
    }
  );
}

/**
 * @param {string} path
 * @param {THREE.Vector3|null} spawnPos
 * @param {boolean} isSecondInstance 是否第二个实例（加载完成清除全部绿色）
 * @param {HTMLElement|null} clickBtnEl
 * @param {string} icuKey
 */
function loadIcuInstance(path, spawnPos=null, isSecondInstance=false, clickBtnEl=null, icuKey){
  console.log("请求加载ICU模型路径：", path, "key:", icuKey);
  if(!path){
    console.error("ICU路径为空！检查PAGE_CONFIG.icu.featureModels");
    return;
  }
  if(isIcuLoading || isIcuAnimating){
    console.warn("ICU加载/动画进行中，忽略本次点击");
    return;
  }
  if(!model){
    alert("主模型还未加载完成，请等待模型显示后，再点击ICU按钮！");
    return;
  }
  isIcuLoading = true;
  loadGltfCached(path, (gltf)=>{
    const icuScene = gltf.scene;
    const icuBox = new THREE.Box3().setFromObject(icuScene);
    const icuCenter = new THREE.Vector3();
    icuBox.getCenter(icuCenter);

    icuScene.position.set(
      -icuCenter.x,
      -icuBox.min.y,
      -icuCenter.z
    );
    const anchor = new THREE.Group();

    if(spawnPos){
      anchor.position.copy(spawnPos);
    }else{
      anchor.position.copy(baseOrigin);
    }

    anchor.add(icuScene);

    let isFirstInstance = (icuInstances.length === 0);
    if(isFirstInstance){
      // 第一个ICU：保留从小放大入场动画，visible正常打开
      anchor.scale.set(0,0,0);
      setIcuGroupVisible(anchor, true);
    }else{
      // 第二个ICU：直接最终scale，初始完全隐藏visible=false，不修改材质
      anchor.scale.set(config.icu.scale, config.icu.scale, config.icu.scale);
      setIcuGroupVisible(anchor, false);
    }

    scene.add(anchor);

    const instanceObj = {
      group: anchor,
      mesh: icuScene,
      boundingBox: icuBox,
      icuKey: icuKey
    };
    icuInstances.push(instanceObj);

    isIcuAnimating = true;

    if(isFirstInstance){
      // =========第一个实例缩放入场==========
      gsap.to(anchor.scale,{
        x:config.icu.scale,
        y:config.icu.scale,
        z:config.icu.scale,
        duration:0.35,
        ease:"power2.out",
        onComplete:()=>{
          isIcuAnimating = false;
        }
      });
    }else{
      // =========第二个实例：旧模型滑移到目标位，新模型在目标位淡入 =========
      const newInst = instanceObj;                                   // 刚加载进来的实例（初始隐藏）
      const oldInst = icuInstances[0] === newInst ? icuInstances[1] : icuInstances[0];
      const posResult = relayoutIcuStackGetTargetPos();
      if(posResult){
        const { baseTargetPos, topTargetPos, baseInst, topInst } = posResult;
        // 动态渲染层级：底层renderOrder小，上层大
        baseInst.group.renderOrder = 1;
        topInst.group.renderOrder = 10;

        // 判断新模型排在底层还是上层，分别取目标坐标
        const newIsBase = (baseInst === newInst);
        const newTargetPos = newIsBase ? baseTargetPos : topTargetPos;
        const oldTargetPos = newIsBase ? topTargetPos : baseTargetPos;

        // 新模型直接放到最终目标坐标（仍隐藏，避免从远处飞来）
        newInst.group.position.copy(newTargetPos);

        // 先把新模型材质置透明并显示，透明度动画并入下面同一条时间线，和滑移同时启动
        const newMats = prepareIcuFadeIn(newInst.group);

        gsap.timeline({
          onComplete:()=>{
            restoreIcuOpaque(newMats);
            isIcuAnimating = false;
          }
        })
        // 旧模型平滑滑移到它的目标位置（不改材质，不闪）
        .to(oldInst.group.position,{
          x: oldTargetPos.x,
          y: oldTargetPos.y,
          z: oldTargetPos.z,
          duration:0.45,
          ease:"power2.out"
        },0)
        // 新模型与滑移同一时刻开始淡入（无论它排底层还是上层）
        .to(newMats, {opacity:1, duration:0.45, ease:"power2.out"}, 0);
      }else{
        isIcuAnimating = false;
      }
    }

    setModelOpacity(model,0.2);
    isIcuLoading = false;

    if(isSecondInstance){
      clearAllStackHighlight();
    }else{
      setStackHighlightByBaseKey(icuKey);
    }
    console.log(`ICU实例加载完成，key=${icuKey}，当前实例数量：${icuInstances.length}`);
  },
  makeThrottledProgress("ICU加载进度："),
  (err)=>{
    console.error("ICU加载失败", err);
    isIcuLoading = false;
    isIcuAnimating = false;
  })
}

function updateCubeRotation() {
  if (!cubeGuideBtn) return;
  const vector = new THREE.Vector3();
  vector.copy(camera.position).sub(controls.target).normalize();
  const phi = Math.atan2(vector.x, vector.z);
  const theta = Math.asin(vector.y);
  const degX = -theta * (180 / Math.PI);
  const degY = -phi * (180 / Math.PI);
  cubeGuideBtn.style.transformStyle = "preserve-3d";
  cubeGuideBtn.style.transform = `rotateX(${degX}deg) rotateY(${degY}deg)`;
}

function initCubeReset() {
  if (!cubeGuideBtn) return;
  cubeGuideBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isResetting) return;
    isResetting = true;
    isAutoRotating = false;
    cubeGuideBtn.style.transition = "0.1s";
    cubeGuideBtn.style.filter = "brightness(1.5)";
    gsap.to(camera.position, {
      x: initialState.cameraPosition.x,
      y: initialState.cameraPosition.y,
      z: initialState.cameraPosition.z,
      duration: 0.8,
      ease: "power3.out",
      onUpdate: () => {
        camera.lookAt(controls.target);
        controls.update();
      },
      onComplete: () => {
        updateCameraSphericalFromCurrent();
        isAutoRotating = true;
        isResetting = false;
        cubeGuideBtn.style.filter = "none";
      }
    });
  });
}

function bindIcuButtons(){
  const btns = document.querySelectorAll(".icu-sub-btn");
  console.log("找到ICU子按钮数量：", btns.length);
  btns.forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const key = btn.dataset.icu;
      const allowStr = (btn.dataset.stackAllow || "").trim();
      const allowList = allowStr ? allowStr.split(',').map(s=>s.trim()) : [];
      const isStackTarget = btn.classList.contains('icu-stack-target');
      const path = config.icu.featureModels[key];
      if(!path) return;

      if(icuInstances.length >= 2){
        // 替换底座：紧接着加载新ICU，主模型保持半透明，不恢复全亮，避免闪烁
        clearAllIcuInstances(false);
        loadIcuInstance(path, null, false, btn, key);
        btn.classList.add('active-icu');
      }else if(icuInstances.length === 0){
        loadIcuInstance(path, null, false, btn, key);
        btn.classList.add('active-icu');
      }else if(icuInstances.length ===1){
        const baseInstance = icuInstances[0];
        const baseKey = baseInstance.icuKey;
        const canStack = isStackTarget && allowList.includes(baseKey);
        if(canStack){
          loadIcuInstance(path, null, true, btn, key);
          btn.classList.add('active-icu');
        }else{
          // 非绿色按钮：替换底座，主模型保持半透明，不恢复全亮，避免闪烁
          clearAllIcuInstances(false);
          loadIcuInstance(path, null, false, btn, key);
          btn.classList.add('active-icu');
        }
      }
    })
  })
}

function updateCameraSphericalFromCurrent() {
  const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  cameraSpherical.radius = spherical.radius;
  cameraSpherical.polarAngle = spherical.phi;
  cameraSpherical.azimuthAngle = spherical.theta;
}

/**
 * 用户开始拖动/缩放：立即停掉自动旋转
 * 同时清掉之前排队的恢复定时器，防止拖动中途被旧定时器重新开启自转
 */
function pauseAutoRotate(){
  isUserInteracting = true;
  isAutoRotating = false;
  if(autoRotateResumeTimer){
    clearTimeout(autoRotateResumeTimer);
    autoRotateResumeTimer = null;
  }
}

/**
 * 用户松手：从松手这一刻重新计时，AUTO_ROTATE_RESUME_MS 之后恢复自动旋转
 * 万一期间又按下，pauseAutoRotate 会把这里的定时器清掉
 */
function scheduleResumeAutoRotate(){
  isUserInteracting = false;
  if(autoRotateResumeTimer){
    clearTimeout(autoRotateResumeTimer);
    autoRotateResumeTimer = null;
  }
  autoRotateResumeTimer = setTimeout(()=>{
    autoRotateResumeTimer = null;
    if(isUserInteracting) return;       // 在等待期间又被拖动了，就别恢复
    updateCameraSphericalFromCurrent();  // 同步当前视角，避免跳一下
    isAutoRotating = true;
  }, AUTO_ROTATE_RESUME_MS);
}

function rotateCameraAroundModel() {
  // 用户正在拖动视角时完全不自动转，避免和手动操作互相抢镜头
  if (isUserInteracting) return;
  if (!isAutoRotating || !model) return;
  cameraSpherical.azimuthAngle += config.autoRotateSpeed;
  const spherical = new THREE.Spherical(
    cameraSpherical.radius,
    cameraSpherical.polarAngle,
    cameraSpherical.azimuthAngle
  );
  camera.position.setFromSpherical(spherical).add(controls.target);
  camera.lookAt(controls.target);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  rotateCameraAroundModel();
  updateCubeRotation();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function init() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.getElementById('3d-container').appendChild(renderer.domElement);
  initLights();
  initCubeReset();
  bindIcuButtons();
  const buttons = document.querySelectorAll('.feature-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const path = config.featureModels[btn.dataset.feature];
      if (path) loadModel(path);
    });
  });
  loadModel(config.modelPath);
  camera.position.copy(initialState.cameraPosition);
  window.addEventListener('resize', onWindowResize);
  // 按下/拖动：立刻停止自动旋转，并清掉之前排队的恢复定时器
  controls.addEventListener('start', pauseAutoRotate);
  // 松手：清掉旧定时器，重新计时（AUTO_ROTATE_RESUME_MS 之后才恢复）
  controls.addEventListener('end', scheduleResumeAutoRotate);
  animate();
}
init();
