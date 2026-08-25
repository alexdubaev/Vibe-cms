import { cn } from '@/lib/utils'

const logoSource = '/brand/vibe-cms-logo.png'

export function CmsBrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('relative block shrink-0 overflow-hidden rounded-lg bg-black', className)}
    >
      <img
        alt=""
        className="absolute left-1/2 top-[60%] h-auto w-[220%] max-w-none -translate-x-1/2 -translate-y-1/2"
        src={logoSource}
      />
    </span>
  )
}

export function CmsBrandArtwork({ className }: { className?: string }) {
  return <img alt="" className={cn('object-contain', className)} src={logoSource} />
}
