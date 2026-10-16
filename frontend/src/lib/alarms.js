export const PRIORITY = {
  1: { label: 'Critical', cls: 'p1' },
  2: { label: 'High', cls: 'p2' },
  3: { label: 'Medium', cls: 'p3' },
  4: { label: 'Low', cls: 'p4' },
}

// ISA 18.2 alarm states
export const STATES = {
  NORMAL:     { label: 'Normal', short: 'Normal', help: 'Process normal. Nothing to acknowledge.' },
  UNACK:      { label: 'Unacknowledged', short: 'Unack', help: 'Process is abnormal and no operator has acknowledged it yet. Flashes until acknowledged.' },
  ACKED:      { label: 'Acknowledged', short: 'Acked', help: 'Process is still abnormal. The operator has acknowledged it and is responding.' },
  RTN_UNACK:  { label: 'Returned to normal, unacknowledged', short: 'RTN unack', help: 'The process recovered before anyone acknowledged. Still needs an acknowledgement so the event is not missed.' },
  SHELVED:    { label: 'Shelved', short: 'Shelved', help: 'Temporarily removed from the alarm list by the operator, for a limited time with a logged reason.' },
  SUPPRESSED: { label: 'Suppressed by design', short: 'Suppressed', help: 'Automatically hidden by a designed rule based on plant state, such as generator alarms while the generator is off.' },
}

export const EVENT_LABELS = {
  ALARM: 'Alarm',
  ACK: 'Acknowledged',
  RTN: 'Return to normal',
  SHELVE: 'Shelved',
  UNSHELVE: 'Unshelved',
  SUPPRESS: 'Suppressed',
  UNSUPPRESS: 'Unsuppressed',
}

export const ANNUNCIATED = ['UNACK', 'ACKED', 'RTN_UNACK']
export const NEEDS_ACK = ['UNACK', 'RTN_UNACK']
