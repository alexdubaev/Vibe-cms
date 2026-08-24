export type PublicationPromotionPort = {
  verifyInactiveMarker(input: { slot: 'blue' | 'green'; revision: number }): Promise<boolean>
  switchActiveSlot(slot: 'blue' | 'green'): Promise<void>
  verifyPublicMarker(revision: number): Promise<boolean>
}

export async function promotePublication(port: PublicationPromotionPort, input: { slot: 'blue' | 'green'; revision: number }) {
  if (!(await port.verifyInactiveMarker(input))) throw new Error('Inactive slot marker verification failed')
  await port.switchActiveSlot(input.slot)
  if (!(await port.verifyPublicMarker(input.revision))) throw new Error('Public publication marker verification failed')
}
