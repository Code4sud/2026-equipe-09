const THREE = window.AFRAME.THREE
const ink = '#F6F3E8'
const muted = '#B9D2D3'
const accent = '#7FE1CE'

window.AFRAME.registerComponent('agora-label', {
  schema: {
    value: { type: 'string' },
    width: { default: 1 },
    height: { default: 0.1 },
    size: { default: 0.058 },
    color: { default: ink }
  },

  init() {
    const { width, height } = this.data
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.ceil(width * 640)
    this.canvas.height = Math.ceil(height * 640)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
    this.el.setObject3D('mesh', this.mesh)
  },

  update() {
    const { value, size, color } = this.data
    const { width, height } = this.canvas
    const context = this.canvas.getContext('2d')
    const fontSize = size * 640
    const lineHeight = fontSize * 1.22
    const maxWidth = width * 0.96

    context.clearRect(0, 0, width, height)
    context.font = `600 ${fontSize}px system-ui, sans-serif`
    context.fillStyle = color
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    const lines = []
    for (const paragraph of value.split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (line && context.measureText(next).width > maxWidth) {
          lines.push(line)
          line = word
        } else {
          line = next
        }
      }
      lines.push(line)
    }
    lines.forEach((line, index) => {
      const y = height / 2 + (index - (lines.length - 1) / 2) * lineHeight
      context.fillText(line, width / 2, y, maxWidth)
    })
    this.texture.needsUpdate = true
  },

  remove() {
    this.el.removeObject3D('mesh')
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.texture.dispose()
  }
})

function entity(parent, tag, attributes) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  parent.append(element)
  return element
}

function group(parent, id) {
  return entity(parent, 'a-entity', { id, visible: false })
}

function plane(parent, width, height, position, color) {
  return entity(parent, 'a-plane', {
    width, height, position,
    material: `shader: flat; color: ${color}`
  })
}

function label(parent, value, position, width, height, size, color = ink) {
  return entity(parent, 'a-entity', {
    position,
    'agora-label': { value, width, height, size, color }
  })
}

function button(parent, title, action, x, y, width, height = 0.18) {
  const color = '#275663'
  const target = plane(parent, width, height, `${x} ${y} 0.025`, color)
  target.setAttribute('agora-target', action)
  target.addEventListener('mouseenter', () => target.setAttribute('material', 'color', '#3B7280'))
  target.addEventListener('mouseleave', () => target.setAttribute('material', 'color', color))
  const caption = label(target, title, '0 0 0.003', width - 0.022, height, 0.052)
  return { target, caption }
}

function setText(element, text) {
  element.setAttribute('agora-label', 'value', text)
}

function panel(parent) {
  plane(parent, 1.94, 1.10, '0 0 0', '#132F3D')
  plane(parent, 1.94, 0.008, '0 0.55 0.002', accent)
}

export function buildLandmarks(root) {
  // Les repères répartis autour du siège donnent une référence visuelle sur 360°.
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6
    const x = 3.8 * Math.sin(angle)
    const z = -3.8 * Math.cos(angle)
    const pillar = entity(root, 'a-entity', {
      position: `${x} 0 ${z}`,
      rotation: `0 ${-index * 30} 0`
    })
    entity(pillar, 'a-box', {
      position: '0 0.66 0', width: 0.21, height: 1.32, depth: 0.21,
      material: 'shader: flat; color: #274752'
    })
    entity(pillar, 'a-box', {
      position: '0 1.34 0', width: 0.23, height: 0.06, depth: 0.23,
      material: `shader: flat; color: ${index % 3 === 0 ? '#E1AC65' : '#76ABA8'}`
    })
  }
}

export function buildUi(root) {
  const welcome = group(root, 'e1-welcome')
  const intro = group(root, 'e1-intro')
  const profile = group(root, 'e1-profile')
  const game = group(root, 'e1-game')
  const demoTools = group(root, 'e1-demo')
  const replayTools = group(root, 'e1-replay')
  const screens = { welcome, intro, profile, game }

  panel(welcome)
  label(welcome, 'AGORA EXPLORER', '0 0.27 0.01', 1.8, 0.19, 0.111)
  label(welcome, 'Découvrez des métiers au fil d’un parcours d’orientation.',
    '0 0.03 0.01', 1.65, 0.22, 0.071, muted)
  button(welcome, 'Lancer les consignes', 'e1:intro', 0, -0.30, 1.02)

  panel(intro)
  const counter = label(intro, '', '0 0.42 0.01', 1.7, 0.11, 0.05, muted)
  const icon = label(intro, '', '0 0.20 0.01', 0.36, 0.32, 0.22, accent)
  const title = label(intro, '', '0 -0.035 0.01', 1.83, 0.16, 0.087)
  const description = label(intro, '', '0 -0.255 0.01', 1.59, 0.29, 0.066)
  plane(intro, 1.62, 0.022, '0 -0.465 0.008', '#2C5260')
  const introProgress = plane(intro, 1.62, 0.022, '-0.81 -0.465 0.014', accent)

  panel(profile)
  label(profile, 'Code du profil', '-0.47 0.37 0.01', 0.94, 0.14, 0.088)
  const code = label(profile, '', '-0.47 0.14 0.01', 0.88, 0.16, 0.097, accent)
  const status = label(profile, '', '-0.47 -0.13 0.01', 0.88, 0.30, 0.054)
  const example = label(profile, '', '-0.47 -0.425 0.01', 0.91, 0.18, 0.045, muted)

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Eff.', '0', 'OK']
  keys.forEach((key, index) => {
    const action = key === 'Eff.' ? 'erase' : key === 'OK' ? 'submit' : `digit:${key}`
    const { target } = button(profile, key, `e1:${action}`,
      0.075 + (index % 3) * 0.305, 0.348 - Math.floor(index / 3) * 0.232, 0.276, 0.191)
    target.id = `e1-key-${action.replace(':', '-')}`
  })

  const validated = label(game, '', '0 -0.64 0.01', 1.8, 0.14, 0.061, muted)
  const demo = button(demoTools, 'Tester la sélection', 'demo', -0.62, 0.69, 0.70)
  demo.target.id = 'demo-target'
  button(replayTools, 'Revoir les consignes', 'e1:replay', 0.55, 0.69, 0.84)
  let demoCount = 0

  return {
    show(screen) {
      for (const [name, element] of Object.entries(screens)) {
        element.setAttribute('visible', screen === name)
      }
      demoTools.setAttribute('visible', screen === 'welcome' || screen === 'game')
      replayTools.setAttribute('visible', screen === 'profile' || screen === 'game')
    },

    drawIntro(step, index, total) {
      setText(counter, `Consignes · ${index + 1} / ${total}`)
      setText(icon, step.icon)
      setText(title, step.title)
      setText(description, step.text)
    },

    animateIntro(progress, stepTime) {
      introProgress.object3D.scale.x = Math.max(progress, 0.001)
      introProgress.object3D.position.x = (progress - 1) * 0.81
      icon.object3D.scale.setScalar(0.79 + 0.21 * Math.min(1, stepTime / 450))
    },

    drawProfile(digits, message, hint) {
      setText(code, digits.padEnd(4, '–').split('').join('  '))
      setText(status, message)
      setText(example, hint)
    },

    confirmProfile(id) {
      setText(validated, `Profil ${id} validé`)
    },

    confirmDemo(input) {
      demoCount++
      setText(demo.caption, `${input === 'gaze' ? 'Regard' : 'Clic'} · ${demoCount}`)
    }
  }
}
