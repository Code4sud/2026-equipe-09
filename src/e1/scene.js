import './gaze-ring.js'
import { buildLandmarks, buildUi } from './ui.js'
import { startFlow } from './flow.js'

const targetSelector = '.agora-interactive[data-action]'
const previewGaze = new URLSearchParams(location.search).get('gaze') === '1'

// Le balisage historique .agora-interactive[data-action] reste compatible.
window.AFRAME.registerComponent('agora-target', {
  schema: { type: 'string' },

  update() {
    const action = this.data.trim()
    this.el.classList.toggle('agora-interactive', Boolean(action))
    if (action) {
      this.el.dataset.action = action
    } else {
      this.el.removeAttribute('data-action')
    }
  },

  remove() {
    this.el.classList.remove('agora-interactive')
    this.el.removeAttribute('data-action')
  }
})

function isVisible(target, scene) {
  for (let entity = target; entity && entity !== scene; entity = entity.parentElement) {
    if (entity.object3D?.visible === false) return false
  }
  return scene.contains(target)
}

function configureInput(scene) {
  const gazePointer = scene.querySelector('#gaze-pointer')
  const mousePointer = scene.querySelector('#mouse-pointer')
  const gazeHud = scene.querySelector('#gaze-hud')
  let activePointer
  let objects

  gazePointer.setAttribute('agora-gaze-ring', '#gaze-fill')

  function updateInput() {
    const immersive = scene.is('vr-mode') && scene.renderer.xr.isPresenting
    const useGaze = immersive || previewGaze
    const nextPointer = useGaze ? gazePointer : mousePointer

    if (activePointer === nextPointer) {
      activePointer.setAttribute('raycaster', 'objects', objects)
      return
    }
    if (activePointer) {
      activePointer.removeAttribute('cursor')
      activePointer.removeAttribute('raycaster')
    }

    gazeHud.setAttribute('visible', useGaze)
    gazePointer.components['agora-gaze-ring'].reset()

    activePointer = nextPointer
    activePointer.setAttribute('raycaster', { objects, far: 3 })
    activePointer.setAttribute('cursor', {
      rayOrigin: useGaze ? 'entity' : 'mouse',
      fuse: useGaze,
      fuseTimeout: 1500,
      mouseCursorStylesEnabled: false
    })
  }

  function activate(event) {
    const target = event.detail?.intersectedEl
    if (event.target !== activePointer || !target?.matches(objects) || !isVisible(target, scene)) return
    if (activePointer === mousePointer && event.detail.mouseEvent?.button > 0) return

    scene.emit('agora-activate', {
      action: target.dataset.action,
      input: activePointer === gazePointer ? 'gaze' : 'mouse',
      target
    }, false)
  }

  gazePointer.addEventListener('click', activate)
  mousePointer.addEventListener('click', activate)
  scene.addEventListener('enter-vr', updateInput)
  scene.addEventListener('exit-vr', updateInput)

  return roots => {
    // Les boutons du moteur (E2) et des résultats (E3) portent la classe .clickable.
    objects = roots.flatMap(id => [`#${id} ${targetSelector}`, `#${id} .clickable`]).join(', ')
    updateInput()
  }
}

function fitInterface(scene) {
  const camera = scene.camera
  const defaultFov = scene.querySelector('#player-camera').getAttribute('camera').fov

  function resize() {
    // Garder le panneau et ses commandes dans le champ sur un écran en portrait.
    const halfWidth = 1.08
    const distance = 2
    const portraitFov = 2 * Math.atan(halfWidth / (distance * camera.aspect)) * 180 / Math.PI
    camera.fov = Math.max(defaultFov, portraitFov)
    camera.updateProjectionMatrix()
  }

  scene.addEventListener('rendererresize', resize)
  resize()
}

window.AFRAME.registerComponent('agora-e1', {
  init() {
    const scene = this.el
    fitInterface(scene)
    buildLandmarks(scene.querySelector('#landmarks'))
    const ui = buildUi(scene.querySelector('#e1-ui'))
    this.tickFlow = startFlow(scene, ui, configureInput(scene))
  },

  tick() {
    this.tickFlow()
  }
})

const scene = document.querySelector('#agora-scene')
function initScene() {
  scene.setAttribute('agora-e1', '')
}

if (scene.hasLoaded) {
  initScene()
} else {
  scene.addEventListener('loaded', initScene, { once: true })
}
