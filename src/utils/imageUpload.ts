import { supabase } from '../lib/supabase'
import type { UploadResult } from '../types'

/**
 * Helper privato per l'upload di un'immagine su Supabase Storage
 */
const uploadImage = async (
  file: File,
  userId: string,
  bucket: string,
  maxSizeMB: number,
  pathPrefix: string = ''
): Promise<UploadResult> => {
  try {
    // Valida il file
    if (!file) {
      throw new Error('Nessun file selezionato')
    }

    // Controlla la dimensione del file
    const maxSize = maxSizeMB * 1024 * 1024
    if (file.size > maxSize) {
      throw new Error(`Il file è troppo grande. La dimensione massima è ${maxSizeMB}MB`)
    }

    // Controlla il tipo MIME
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Tipo di file non supportato. Usa: JPG, PNG, WebP o GIF')
    }

    // Genera un nome file unico
    const fileExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
    const fileName = `${crypto.randomUUID()}.${fileExt}`
    const filePath = pathPrefix ? `${userId}/${pathPrefix}/${fileName}` : `${userId}/${fileName}`

    // Carica il file su Supabase Storage
    const { error } = await supabase.storage
      .from(bucket)
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
      .from(bucket)
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
 * Helper privato per eliminare un'immagine da Supabase Storage
 */
const deleteImage = async (filePath: string, bucket: string): Promise<void> => {
  try {
    const { error } = await supabase.storage
      .from(bucket)
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
 * Helper privato per ottenere l'URL pubblico di un'immagine
 */
const getImageUrl = (filePath: string, bucket: string): string | null => {
  if (!filePath) return null
  
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath)
  
  return publicUrl
}

/**
 * Upload un'immagine del gioco su Supabase Storage
 */
export const uploadGameImage = async (file: File, userId: string): Promise<UploadResult> => {
  return uploadImage(file, userId, 'game-images', 5)
}

/**
 * Upload un'immagine del profilo del giocatore su Supabase Storage
 */
export const uploadPlayerImage = async (file: File, userId: string): Promise<UploadResult> => {
  return uploadImage(file, userId, 'player-images', 2, 'avatars')
}

/**
 * Elimina un'immagine del profilo del giocatore da Supabase Storage
 */
export const deletePlayerImage = async (filePath: string): Promise<void> => {
  return deleteImage(filePath, 'player-images')
}

/**
 * Ottiene l'URL pubblico di un'immagine del profilo dal path
 */
export const getPlayerImageUrl = (filePath: string): string | null => {
  return getImageUrl(filePath, 'player-images')
}

/**
 * Comprime un'immagine prima dell'upload
 */
export const compressImage = async (file: File, maxWidth: number = 800, quality: number = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target!.result as string
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

        const ctx = canvas.getContext('2d')!
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
