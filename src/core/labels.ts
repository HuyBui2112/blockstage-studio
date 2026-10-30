export const resourceName = (id: string) => (id.split(':')[1] ?? id).replaceAll('_', ' ').replaceAll('/', ' / ')
