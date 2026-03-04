import { supabase } from '../lib/supabase'

/**
 * Upload un'immagine del gioco su Supabase Storage
 * @param {File} file - Il file dell'immagine da caricare
 * @param {string} userId - L'ID dell'utente autenticato
 * @param {string} gameId - L'ID del gioco (opzionale, per aggiornare un gioco esistente)
 * @returns {Promise<{publicUrl: string, path: string}>} L'URL pubblico e il path dell'immagine caricata
 */
export const uploadGameImage = async (file, userId, gameId = null) => {
  try {
    // Valida il file
    if (!file) {
      throw new Error('Nessun file selezionato')
    }

    // Controlla la dimensione del file (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      throw new Error('Il file è troppo grande. La dimensione massima è 5MB')
    }

    // Controlla il tipo MIME
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Tipo di file non supportato. Usa: JPG, PNG, WebP o GIF')
    }

    // Genera un nome file unico
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`
    const filePath = `${userId}/${fileName}`

    // Carica il file su Supabase Storage
    const { data, error } = await supabase.storage
      .from('game-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('Errore durante l\'upload:', error)
      throw error
    }

    // Ottieni l'URL pubblico dell'immagine
    const { data: { publicUrl } } = supabase.storage
      .from('game-images')
      .getPublicUrl(filePath)

    return {
      publicUrl,
      path: filePath
    }
  } catch (error) {
    console.error('Errore durante l\'upload dell\'immagine:', error)
    throw error
  }
}

/**
 * Elimina un'immagine del gioco da Supabase Storage
 * @param {string} filePath - Il percorso del file da eliminare
 * @returns {Promise<void>}
 */
export const deleteGameImage = async (filePath) => {
  try {
    const { error } = await supabase.storage
      .from('game-images')
      .remove([filePath])

    if (error) {
      console.error('Errore durante l\'eliminazione:', error)
      throw error
    }
  } catch (error) {
    console.error('Errore durante l\'eliminazione dell\'immagine:', error)
    throw error
  }
}

/**
 * Ottiene l'URL pubblico di un'immagine dal path
 * @param {string} filePath - Il percorso del file
 * @returns {string} L'URL pubblico dell'immagine
 */
export const getGameImageUrl = (filePath) => {
  if (!filePath) return null
  
  const { data: { publicUrl } } = supabase.storage
    .from('game-images')
    .getPublicUrl(filePath)
  
  return publicUrl
}

/**
 * Upload un'immagine del profilo del giocatore su Supabase Storage
 * @param {File} file - Il file dell'immagine da caricare
 * @param {string} userId - L'ID dell'utente autenticato
 * @param {string} playerId - L'ID del giocatore (opzionale, per aggiornare un giocatore esistente)
 * @returns {Promise<{publicUrl: string, path: string}>} L'URL pubblico e il path dell'immagine caricata
 */
export const uploadPlayerImage = async (file, userId, playerId = null) => {
  try {
    // Valida il file
    if (!file) {
      throw new Error('Nessun file selezionato')
    }

    // Controlla la dimensione del file (max 2MB per avatar)
    const maxSize = 2 * 1024 * 1024 // 2MB
    if (file.size > maxSize) {
      throw new Error('Il file è troppo grande. La dimensione massima è 2MB')
    }

    // Controlla il tipo MIME
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Tipo di file non supportato. Usa: JPG, PNG, WebP o GIF')
    }

    // Genera un nome file unico
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`
    const filePath = `${userId}/avatars/${fileName}`

    // Carica il file su Supabase Storage
    const { data, error } = await supabase.storage
      .from('player-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('Errore durante l\'upload:', error)
      throw error
    }

    // Ottieni l'URL pubblico dell'immagine
    const { data: { publicUrl } } = supabase.storage
      .from('player-images')
      .getPublicUrl(filePath)

    return {
      publicUrl,
      path: filePath
    }
  } catch (error) {
    console.error('Errore durante l\'upload dell\'immagine del profilo:', error)
    throw error
  }
}

/**
 * Elimina un'immagine del profilo del giocatore da Supabase Storage
 * @param {string} filePath - Il percorso del file da eliminare
 * @returns {Promise<void>}
 */
export const deletePlayerImage = async (filePath) => {
  try {
    const { error } = await supabase.storage
      .from('player-images')
      .remove([filePath])

    if (error) {
      console.error('Errore durante l\'eliminazione:', error)
      throw error
    }
  } catch (error) {
    console.error('Errore durante l\'eliminazione dell\'immagine del profilo:', error)
    throw error
  }
}

/**
 * Ottiene l'URL pubblico di un'immagine del profilo dal path
 * @param {string} filePath - Il percorso del file
 * @returns {string} L'URL pubblico dell'immagine
 */
export const getPlayerImageUrl = (filePath) => {
  if (!filePath) return null
  
  const { data: { publicUrl } } = supabase.storage
    .from('player-images')
    .getPublicUrl(filePath)
  
  return publicUrl
}

/**
 * Comprime un'immagine prima dell'upload
 * @param {File} file - Il file dell'immagine
 * @param {number} maxWidth - Larghezza massima in pixel
 * @param {number} quality - Qualità dell'immagine (0-1)
 * @returns {Promise<Blob>} L'immagine compressa
 */
export const compressImage = async (file, maxWidth = 800, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target.result
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // Ridimensiona se necessario
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Errore durante la compressione dell\'immagine'))
            }
          },
          file.type,
          quality
        )
      }
      img.onerror = () => reject(new Error('Errore durante il caricamento dell\'immagine'))
    }
    reader.onerror = () => reject(new Error('Errore durante la lettura del file'))
  })
}
