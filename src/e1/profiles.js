const profileUrl = new URL('../../data/profils.json', import.meta.url)

// Exemples réservés à la démo si le fichier de C3 n’a pas encore été livré.
const demoProfiles = ['0042', '1709'].map(id => ({
  id,
  fictif: true,
  riasec: { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 },
  aptitudes: {},
  hexaco: { H: 50, E: 50, X: 50, A: 50, C: 50, O: 50 },
  champ_des_possibles: [{ onet: '35-2014.00', zone: 2 }],
  classement_entretien: ['35-2014.00']
}))

export async function loadProfiles() {
  const response = await fetch(profileUrl)
  if (response.status === 404) return { profiles: demoProfiles, demo: true }
  if (!response.ok) throw new Error('Fichier des profils indisponible')

  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('Format du fichier des profils invalide')
  const profiles = data.filter(profile =>
    profile?.fictif === true && typeof profile.id === 'string' && /^\d{4}$/.test(profile.id)
  )
  return { profiles, demo: false }
}
