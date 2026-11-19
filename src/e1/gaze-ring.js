window.AFRAME.registerComponent('agora-gaze-ring', {
  schema: { type: 'selector' },

  init() {
    this.mesh = this.data.getObject3D('mesh')
    this.originalGeometry = this.mesh.geometry
    this.geometry = this.originalGeometry.clone()
    this.mesh.geometry = this.geometry
    this.segments = this.geometry.index.count / 6
    this.reset()
  },

  events: {
    fusing() {
      this.startedAt = performance.now()
      this.duration = this.el.getAttribute('cursor').fuseTimeout
      this.draw(0)
    },
    mouseleave() {
      this.reset()
    },
    click() {
      this.startedAt = null
      this.draw(1)
    }
  },

  tick() {
    if (this.startedAt === null) return

    const elapsed = performance.now() - this.startedAt
    this.draw(Math.min(elapsed / this.duration, 1))
  },

  reset() {
    this.startedAt = null
    this.draw(0)
  },

  draw(progress) {
    // Deux triangles indexés par segment. Le maillage reste le même.
    this.geometry.setDrawRange(0, Math.floor(progress * this.segments) * 6)
  },

  remove() {
    this.mesh.geometry = this.originalGeometry
    this.geometry.dispose()
  }
})
