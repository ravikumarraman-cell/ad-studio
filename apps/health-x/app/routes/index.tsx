import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

type Appointment = { clinician: string; specialty: string; time: string; location: string }
type Density = 'comfortable' | 'compact'

const densityStorageKey = 'health-x.dashboard-density'
const appointments: Appointment[] = [
  { clinician: 'Dr. Maya Chen', specialty: 'Primary care', time: '10:30 AM', location: 'North Clinic, Room 204' },
  { clinician: 'Jordan Lee', specialty: 'Care coordinator', time: 'Thursday, 2:00 PM', location: 'Video visit' },
]
const medications = [
  { id: 'morning', name: 'Morning medication', detail: 'Take with breakfast' },
  { id: 'evening', name: 'Evening medication', detail: 'Take after dinner' },
]
const careTasks = [
  { id: 'questions', title: 'Write down questions for your visit', detail: 'A short list helps you make the most of your appointment.' },
  { id: 'movement', title: 'Take a 10-minute walk', detail: 'Choose a pace that feels comfortable today.' },
]

export const Route = createFileRoute('/')({ component: HealthX })

function HealthX() {
  const [checkedIn, setCheckedIn] = useState(false)
  const [taken, setTaken] = useState<string[]>([])
  const [completedTasks, setCompletedTasks] = useState<string[]>([])
  const [density, setDensity] = useState<Density>('comfortable')
  const nextAppointment = appointments[0]

  useEffect(() => {
    try {
      const storedDensity = window.localStorage.getItem(densityStorageKey)
      if (storedDensity === 'compact' || storedDensity === 'comfortable') setDensity(storedDensity)
    } catch {}
  }, [])

  const chooseDensity = (nextDensity: Density) => {
    setDensity(nextDensity)
    try { window.localStorage.setItem(densityStorageKey, nextDensity) } catch {}
  }
  const useDefaultDensity = () => {
    setDensity('comfortable')
    try { window.localStorage.removeItem(densityStorageKey) } catch {}
  }
  const toggle = (id: string, values: string[], setValues: (next: string[]) => void) => {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  }

  return <main className={`app-shell density-${density}`}>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Health-X home"><span className="brand-mark" aria-hidden="true">+</span>Health-X</a>
      <p>Tuesday, August 20</p>
    </header>
    <section className="display-preferences" aria-labelledby="display-preferences-heading">
      <div><p className="eyebrow">Personal control</p><h2 id="display-preferences-heading">Dashboard display</h2><p>Choose how much space your dashboard uses on this browser.</p></div>
      <div className="density-controls" role="group" aria-label="Dashboard display preferences">
        <button type="button" aria-pressed={density === 'comfortable'} onClick={() => chooseDensity('comfortable')}>Comfortable</button>
        <button type="button" aria-pressed={density === 'compact'} onClick={() => chooseDensity('compact')}>Compact</button>
        <button type="button" className="default-density" onClick={useDefaultDensity}>Use default</button>
      </div>
    </section>
    <section className="welcome" id="top" aria-labelledby="welcome-heading"><div><p className="eyebrow">Your care day</p><h1 id="welcome-heading">Good morning, Alex</h1><p className="lede">Your care plan is clear. Start with your appointment, then make room for the small things.</p></div><aside className="day-summary" aria-label="Today summary"><span>Today</span><strong>{taken.length + completedTasks.length} actions complete</strong><small>One appointment scheduled</small></aside></section>
    <section className="next-step" aria-labelledby="appointments-heading"><div className="section-heading"><div><p className="eyebrow">Next up</p><h2 id="appointments-heading">Your appointment</h2></div><span className="status">{checkedIn ? 'Checked in' : 'Today'}</span></div><article className="appointment"><div><p className="appointment-time">{nextAppointment.time}</p><span>Today</span></div><div><h3>{nextAppointment.clinician}</h3><p>{nextAppointment.specialty} <span aria-hidden="true">|</span> {nextAppointment.location}</p></div><button type="button" className="primary" onClick={() => setCheckedIn((value) => !value)}>{checkedIn ? 'You are checked in' : 'Check in'}</button></article></section>
    <section className="today" aria-labelledby="today-heading"><div className="today-heading"><div><p className="eyebrow">When you are ready</p><h2 id="today-heading">A few small things for today</h2></div><span className="daily-progress">{taken.length + completedTasks.length} of {medications.length + careTasks.length} complete</span></div><div className="progress" aria-label={`${taken.length + completedTasks.length} of ${medications.length + careTasks.length} daily actions complete`}><span style={{ width: `${((taken.length + completedTasks.length) / (medications.length + careTasks.length)) * 100}%` }} /></div><div className="routine-grid"><Routine heading="Medication" items={medications} values={taken} setValues={setTaken} toggle={toggle} /><Routine heading="Care plan" items={careTasks} values={completedTasks} setValues={setCompletedTasks} toggle={toggle} /></div></section>
    <aside className="upcoming" aria-label="Later this week"><span>Later this week</span><strong>{appointments[1].time} with {appointments[1].clinician}</strong><span>{appointments[1].location}</span><button type="button">View details</button></aside>
    <footer><p>Health-X is a demonstration application with fictional data. It does not provide medical advice or retain health information.</p></footer>
  </main>
}

function Routine({ heading, items, values, setValues, toggle }: { heading: string; items: typeof medications | typeof careTasks; values: string[]; setValues: (values: string[]) => void; toggle: (id: string, values: string[], setValues: (next: string[]) => void) => void }) {
  return <section className="routine" aria-labelledby={`${heading}-heading`}><div className="routine-heading"><h3 id={`${heading}-heading`}>{heading}</h3><span>{values.length}/{items.length}</span></div><ul className="action-list">{items.map((item) => <li key={item.id}><button type="button" className={`check ${values.includes(item.id) ? 'is-complete' : ''}`} onClick={() => toggle(item.id, values, setValues)}><span aria-hidden="true">{values.includes(item.id) ? 'Done' : 'Mark'}</span><span><strong>{item.name ?? item.title}</strong><small>{item.detail}</small></span></button></li>)}</ul></section>
}
