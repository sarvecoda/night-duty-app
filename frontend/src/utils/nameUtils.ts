/**
 * Utility functions for handling saint names
 */

/**
 * Generates initials from a saint's name, excluding common prefixes like "Rev." and suffixes like "ji"
 * @param name - The saint's full name
 * @returns Uppercase initials string
 */
export function getSaintInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  const filtered = words.filter(word => {
    const normalized = word.toLowerCase().replace(/\.$/, '')
    return normalized !== 'rev' && normalized !== 'ji'
  })
  
  if (filtered.length === 0) return name.substring(0, 2).toUpperCase()
  
  return filtered.map(w => w[0]).join('').toUpperCase()
}
