const THREE = window.AFRAME.THREE
const ink = '#FCF9FF'
const muted = '#D0C9F3'
const accent = '#FF86D4'
const lavender = '#BFB2FF'
const surfaceStyles = {
  panel: { fill: ['#302664', '#1B1742'], border: ['#8A74EE', '#544289'], radius: 0.09 },
  inset: { fill: ['#1D183F', '#181435'], border: ['#60518E', '#443667'], radius: 0.04 },
  primary: {
    fill: ['#5E43C2', '#5931A0'],
    border: ['#B29BFF', '#DF66BB'],
    hover: ['#7056D6', '#7139AE'],
    radius: 0.048
  },
  secondary: {
    fill: ['#34285E', '#2A214E'],
    border: ['#7764A9', '#5A4785'],
    hover: ['#533F91', '#433076'],
    radius: 0.043
  }
}

window.AFRAME.registerComponent('agora-label', {
  schema: {
    value: { type: 'string' },
    width: { default: 1 },
    height: { default: 0.1 },
    size: { default: 0.058 },
    color: { default: ink },
    style: { default: '600' }
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
    const { value, size, color, style } = this.data
    const { width, height } = this.canvas
    const context = this.canvas.getContext('2d')
    const fontSize = size * 640
    const lineHeight = fontSize * 1.22
    const maxWidth = width * 0.96

    context.clearRect(0, 0, width, height)
    context.font = `${style} ${fontSize}px system-ui, sans-serif`
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

window.AFRAME.registerComponent('agora-surface', {
  schema: {
    width: { type: 'number' },
    height: { type: 'number' },
    variant: { default: 'panel' },
    hovered: { default: false }
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
      alphaTest: 0.35,
      toneMapped: false
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
    this.el.setObject3D('mesh', this.mesh)
  },

  update() {
    const { variant, hovered } = this.data
    const { width, height } = this.canvas
    const { fill, border, hover, radius } = surfaceStyles[variant]
    const context = this.canvas.getContext('2d')
    const stroke = variant === 'panel' ? 5 : 4
    const padding = stroke / 2 + 1
    const [top, bottom] = hovered ? hover : fill
    const gradient = context.createLinearGradient(0, 0, width * 0.4, height)
    gradient.addColorStop(0, top)
    gradient.addColorStop(1, bottom)
    const outline = context.createLinearGradient(0, 0, width, height)
    outline.addColorStop(0, hovered ? '#E0CCFF' : border[0])
    outline.addColorStop(1, hovered ? accent : border[1])

    context.clearRect(0, 0, width, height)
    context.beginPath()
    context.roundRect(padding, padding, width - 2 * padding, height - 2 * padding, radius * 640)
    context.fillStyle = gradient
    context.fill()
    context.lineWidth = stroke
    context.strokeStyle = outline
    context.stroke()
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

function surface(parent, { width, height, position, variant }) {
  return entity(parent, 'a-entity', {
    position,
    'agora-surface': { width, height, variant }
  })
}

function label(parent, value, position, width, height, size, color = ink, style = '600') {
  return entity(parent, 'a-entity', {
    position,
    'agora-label': { value, width, height, size, color, style }
  })
}

function button(parent, title, action, x, y, width, { height = 0.18, primary = false } = {}) {
  const target = surface(parent, {
    width, height, position: `${x} ${y} 0.025`, variant: primary ? 'primary' : 'secondary'
  })
  target.setAttribute('agora-target', action)
  target.addEventListener('mouseenter', () => target.setAttribute('agora-surface', 'hovered', true))
  target.addEventListener('mouseleave', () => target.setAttribute('agora-surface', 'hovered', false))
  const caption = label(target, title, '0 0 0.003', width - 0.06, height, 0.054)
  return { target, caption }
}

function setText(element, text) {
  element.setAttribute('agora-label', 'value', text)
}

function panel(parent, height = 1.10) {
  surface(parent, { width: 1.94, height, position: '0 0 0', variant: 'panel' })
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
      material: 'shader: flat; color: #2B245B'
    })
    entity(pillar, 'a-box', {
      position: '0 1.34 0', width: 0.23, height: 0.04, depth: 0.23,
      material: `shader: flat; color: ${index % 3 === 0 ? '#DF55B8' : '#8173F4'}`
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

  panel(welcome, 1.36)
  entity(welcome, 'a-image', {
    src: '#centre-des-possibles', position: '0 0.386 0.012',
    width: 0.52, height: 0.458, material: 'transparent: true; depthWrite: false'
  })
  label(welcome, 'LE JEU DES POSSIBLES', '0 0.079 0.01', 1.83, 0.19, 0.105, ink, 'italic 900')
  label(welcome, 'Découvrez des métiers au fil d’un parcours d’orientation.',
    '0 -0.11 0.01', 1.58, 0.21, 0.072, muted)
  button(welcome, 'Lancer les consignes', 'e1:intro', 0, -0.327, 1.18, { primary: true })

  panel(intro)
  const counter = label(intro, '', '0 0.42 0.01', 1.7, 0.11, 0.056, lavender)
  surface(intro, { width: 0.36, height: 0.29, position: '0 0.205 0.006', variant: 'inset' })
  const icon = label(intro, '', '0 0.205 0.01', 0.36, 0.29, 0.19, accent)
  const title = label(intro, '', '0 -0.048 0.01', 1.8, 0.17, 0.093, ink, '750')
  const description = label(intro, '', '0 -0.275 0.01', 1.65, 0.29, 0.069, muted)
  plane(intro, 1.62, 0.022, '0 -0.465 0.008', '#514180')
  const introProgress = plane(intro, 1.62, 0.022, '-0.81 -0.465 0.014', accent)
  button(intro, 'Passer les consignes', 'e1:skip-intro', -0.55, 0.69, 0.84)
  button(intro, 'Étape suivante', 'e1:next-intro-step', 0.55, 0.69, 0.84, { primary: true })

  panel(profile)
  label(profile, 'Code du profil', '-0.47 0.35 0.01', 0.87, 0.14, 0.09, ink, '750')
  surface(profile, { width: 0.80, height: 0.195, position: '-0.47 0.13 0.005', variant: 'inset' })
  const code = label(profile, '', '-0.47 0.13 0.01', 0.75, 0.16, 0.10, accent)
  const status = label(profile, '', '-0.47 -0.13 0.01', 0.80, 0.26, 0.057)
  const example = label(profile, '', '-0.47 -0.393 0.01', 0.80, 0.23, 0.048, muted)

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Eff.', '0', 'OK']
  keys.forEach((key, index) => {
    const action = key === 'Eff.' ? 'erase' : key === 'OK' ? 'submit' : `digit:${key}`
    const { target } = button(profile, key, `e1:${action}`,
      0.075 + (index % 3) * 0.305, 0.348 - Math.floor(index / 3) * 0.232, 0.276,
      { height: 0.191, primary: key === 'OK' })
    target.id = `e1-key-${action.replace(':', '-')}`
  })

  // Au-dessus de la carte du moteur (E2), pour ne pas la masquer.
  surface(game, { width: 1.04, height: 0.16, position: '0 1.17 0', variant: 'inset' })
  const validated = label(game, '', '0 1.17 0.01', 0.95, 0.14, 0.061, lavender)
  const demo = button(demoTools, 'Tester la sélection', 'demo', -0.62, 0.69, 0.70)
  demo.target.id = 'demo-target'
  button(replayTools, 'Revoir les consignes', 'e1:replay', 0.55, 0.69, 0.84)
  let demoCount = 0

  return {
    show(screen) {
      for (const [name, element] of Object.entries(screens)) {
        element.setAttribute('visible', screen === name)
      }
      demoTools.setAttribute('visible', screen === 'welcome')
      demoTools.setAttribute('position', screen === 'welcome' ? '0.62 -1.22 0' : '0 0 0')
      replayTools.setAttribute('visible', screen === 'profile' || screen === 'game')
      // En partie, « Revoir les consignes » passe à gauche de la carte du moteur :
      // le bas de la vue reste libre pour voir le pion et les cases suivantes.
      replayTools.setAttribute('position', screen === 'game' ? '-2.05 -0.99 0' : '0 0 0')
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
