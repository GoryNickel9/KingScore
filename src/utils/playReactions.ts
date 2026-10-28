export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '👏', '🔥', '🤔', '😢', '😡', '🤯', '👎'] as const
export type ReactionEmoji = typeof REACTION_EMOJIS[number]

export function nextReaction(selected: string | undefined, clicked: ReactionEmoji): ReactionEmoji | null {
  return selected === clicked ? null : clicked
}
