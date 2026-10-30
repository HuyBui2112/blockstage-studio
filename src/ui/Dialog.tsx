import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Dialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = `dialog-${title.toLowerCase().replaceAll(' ', '-')}`
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className={`resource-dialog ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="dialog-heading"><div><span className="panel-eyebrow">Blockstage Studio</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose} autoFocus><Icon name="close" size={19} /></button></header>
    {children}
  </dialog>
}
