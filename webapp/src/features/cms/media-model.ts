import type { MediaAsset } from '@web-app-demo/contracts'

const mediaUnits = ['Б', 'КБ', 'МБ', 'ГБ'] as const

export function formatMediaBytes(bytes: number) {
  let value = Math.max(0, bytes)
  let unitIndex = 0
  while (value >= 1000 && unitIndex < mediaUnits.length - 1) {
    value /= 1000
    unitIndex += 1
  }

  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${mediaUnits[unitIndex]}`
}

export function mediaStateLabel(state: MediaAsset['state']) {
  switch (state) {
    case 'pending':
      return 'Обрабатывается'
    case 'ready':
      return 'Готово'
    case 'deleting':
      return 'Удаляется'
    case 'deleted':
      return 'Удалено'
  }
}

export function mediaDimensionsLabel(asset: Pick<MediaAsset, 'width' | 'height'>) {
  return asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'Размеры не указаны'
}
