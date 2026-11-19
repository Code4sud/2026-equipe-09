import { introSteps } from './intro-content.js'
import { loadProfiles } from './profiles.js'

const introLength = introSteps.reduce((total, step) => total + step.seconds * 1000, 0)

const targetRoots = {
  welcome: ['e1-welcome', 'e1-demo'],
  intro: ['e1-intro'],
  profile: ['e1-profile', 'e1-replay'],
  game: ['e1-game', 'e1-demo', 'e1-replay', 'board-root', 'results-root']
}

export function startFlow(scene, ui, setTargetRoots) {
  const gameContent = scene.querySelector('#game-content')
  let screen
  let playback
  let digits = ''
  let message = ''
  let profileData
  let profileError = false

  function show(next) {
    screen = next
    ui.show(screen)
    gameContent.setAttribute('visible', screen === 'game')
    setTargetRoots(targetRoots[screen])
  }

  function drawProfile() {
    const hint = profileData?.demo
      ? `Codes de démo · ${profileData.profiles.map(profile => profile.id).join(' / ')}`
      : 'Au regard, détournez les yeux avant de sélectionner à nouveau la même touche.'
    const status = profileError
      ? 'Fichier des profils indisponible. Rechargez la page pour réessayer.'
      : message || (profileData ? 'Saisissez les quatre chiffres, puis validez avec OK.' : 'Chargement des profils…')
    ui.drawProfile(digits, status, hint)
  }

  function validateProfile() {
    if (!profileData) return
    if (digits.length !== 4) {
      message = 'Le code doit contenir quatre chiffres.'
      drawProfile()
      return
    }

    const profile = profileData.profiles.find(entry => entry.id === digits)
    if (!profile) {
      message = 'Code inconnu. Vérifiez les chiffres et réessayez.'
      drawProfile()
      return
    }

    ui.confirmProfile(profile.id)
    show('game')
    scene.emit('agora-start', { profile }, false)
  }

  function openIntro() {
    const returnScreen = screen === 'welcome' ? 'profile' : screen
    const replay = screen !== 'welcome'
    playback = { returnScreen, replay, startedAt: performance.now(), stepIndex: -1 }
    show('intro')
    tick()
    scene.emit('agora-intro', { open: true, replay, screen: returnScreen }, false)
  }

  function tick() {
    if (!playback) return

    const elapsed = performance.now() - playback.startedAt
    if (elapsed >= introLength) {
      const { returnScreen, replay } = playback
      playback = undefined
      show(returnScreen)
      scene.emit('agora-intro', { open: false, replay, screen: returnScreen }, false)
      return
    }

    let stepStart = 0
    const index = introSteps.findIndex(step => {
      const end = stepStart + step.seconds * 1000
      if (elapsed < end) return true
      stepStart = end
      return false
    })
    if (index !== playback.stepIndex) {
      playback.stepIndex = index
      ui.drawIntro(introSteps[index], index, introSteps.length)
    }
    ui.animateIntro(elapsed / introLength, elapsed - stepStart)
  }

  scene.addEventListener('agora-activate', ({ detail: { action, input, target } }) => {
    if (action === 'demo' && target.id === 'demo-target') ui.confirmDemo(input)
    if ((screen === 'welcome' && action === 'e1:intro') ||
        ((screen === 'profile' || screen === 'game') && action === 'e1:replay')) {
      openIntro()
      return
    }
    if (screen !== 'profile' || !target.closest('#e1-profile')) return

    if (action === 'e1:submit') {
      validateProfile()
      return
    }
    if (action === 'e1:erase') {
      digits = digits.slice(0, -1)
    } else if (/^e1:digit:\d$/.test(action) && digits.length < 4) {
      digits += action.at(-1)
    } else {
      return
    }
    message = ''
    drawProfile()
  })

  drawProfile()
  show('welcome')
  loadProfiles()
    .then(data => { profileData = data })
    .catch(() => { profileError = true })
    .finally(drawProfile)

  return tick
}
