import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

type Appointment = { clinician: string; specialty: string; time: string; location: string }

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
  const [view, setView] = useState<'after' | 'before'>('after')
  const nextAppointment = appointments[0]

  const toggle = (id: string, values: string[], setValues: (next: string[]) => void) => {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  }

  const isBefore = view === 'before'

  return <main className={`app-shell ${isBefore ? 'before-view' : 'after-view'}`}>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Health-X home"><span className="brand-mark" aria-hidden="true">+</span>Health-X</a>
      <div className="topbar-actions"><p>Tuesday, August 20</p><div className="view-switch" role="group" aria-label="Design comparison"><button type="button" className={view === 'before' ? 'is-active' : ''} onClick={() => setView('before')}>Before</button><button type="button" className={view === 'after' ? 'is-active' : ''} onClick={() => setView('after')}>After</button></div></div>
    </header>

    {isBefore ? <BeforeFeatureView nextAppointment={nextAppointment} /> : <AfterFeatureView checkedIn={checkedIn} completedTasks={completedTasks} nextAppointment={nextAppointment} setCheckedIn={setCheckedIn} setCompletedTasks={setCompletedTasks} setTaken={setTaken} taken={taken} toggle={toggle} />}

    <footer><p>Health-X is a demonstration application with fictional data. It does not provide medical advice or retain health information.</p></footer>
  </main>
}

function BeforeFeatureView({ nextAppointment }: { nextAppointment: Appointment }) {
  return <>
    <section className="legacy-hero" id="top" aria-labelledby="welcome-heading"><p>Before feature deployment</p><h1 id="welcome-heading">Your health portal</h1><span>Welcome, Alex</span></section>
    <section className="legacy-panel" aria-labelledby="legacy-appointments-heading"><h2 id="legacy-appointments-heading">Upcoming appointments</h2><article className="legacy-appointment"><div><p>{nextAppointment.time} today</p><h3>{nextAppointment.clinician}</h3><span>{nextAppointment.specialty}</span><span>{nextAppointment.location}</span></div><button type="button" className="legacy-button">View appointment</button></article></section>
    <section className="legacy-panel legacy-empty" aria-labelledby="legacy-tasks-heading"><h2 id="legacy-tasks-heading">My health</h2><p>There are no updates to show today.</p></section>
    <aside className="legacy-support"><strong>Need help?</strong><span>Contact your care team during regular clinic hours.</span><button type="button">Contact care team</button></aside>
  </>
}

function AfterFeatureView({ checkedIn, completedTasks, nextAppointment, setCheckedIn, setCompletedTasks, setTaken, taken, toggle }: { checkedIn: boolean; completedTasks: string[]; nextAppointment: Appointment; setCheckedIn: (value: boolean | ((current: boolean) => boolean)) => void; setCompletedTasks: (values: string[]) => void; setTaken: (values: string[]) => void; taken: string[]; toggle: (id: string, values: string[], setValues: (next: string[]) => void) => void }) {
  const completed = taken.length + completedTasks.length
  return <>
    <aside className="release-delta" aria-label="Features added after deployment"><div><span className="release-kicker">Deployed feature</span><strong>Care day workspace</strong></div><p>Check in for today&apos;s visit, complete medication and care-plan actions, and see your progress in one place.</p><ul><li>Visit check-in</li><li>Daily action tracking</li><li>Medication and care plan</li></ul></aside>
    <section className="welcome" id="top" aria-labelledby="welcome-heading"><div><p className="eyebrow">Your care day</p><h1 id="welcome-heading">Good morning, Alex</h1><p className="lede">Your care plan is clear. Start with your appointment, then make room for the small things.</p></div><aside className="day-summary" aria-label="Today summary"><span>Today</span><strong>{completed} actions complete</strong><small>One appointment scheduled</small></aside></section>
    <section className="next-step" aria-labelledby="appointments-heading"><div className="section-heading"><div><p className="eyebrow">Next up</p><h2 id="appointments-heading">Your appointment</h2></div><span className="status">{checkedIn ? 'Checked in' : 'Today'}</span></div><article className="appointment"><div className="appointment-time-block"><p className="appointment-time">{nextAppointment.time}</p><span>Today</span></div><div className="appointment-details"><h3>{nextAppointment.clinician}</h3><p>{nextAppointment.specialty} <span aria-hidden="true">|</span> {nextAppointment.location}</p></div><button type="button" className="primary" onClick={() => setCheckedIn((value) => !value)}>{checkedIn ? 'You are checked in' : 'Check in'}</button></article></section>
    <section className="today" aria-labelledby="today-heading"><div className="today-heading"><div><p className="eyebrow">When you are ready</p><h2 id="today-heading">A few small things for today</h2></div><span className="daily-progress">{completed} of {medications.length + careTasks.length} complete</span></div><div className="progress" aria-label={`${completed} of ${medications.length + careTasks.length} daily actions complete`}><span className={`progress-value progress-${completed}`} /></div><div className="routine-grid"><section className="routine" aria-labelledby="medications-heading"><div className="routine-heading"><h3 id="medications-heading">Medication</h3><span>{taken.length}/{medications.length}</span></div><ul className="action-list">{medications.map((medication) => <li key={medication.id}><button type="button" className={`check ${taken.includes(medication.id) ? 'is-complete' : ''}`} onClick={() => toggle(medication.id, taken, setTaken)}><span aria-hidden="true">{taken.includes(medication.id) ? 'Done' : 'Mark'}</span><span><strong>{medication.name}</strong><small>{medication.detail}</small></span></button></li>)}</ul></section><section className="routine" aria-labelledby="plan-heading"><div className="routine-heading"><h3 id="plan-heading">Care plan</h3><span>{completedTasks.length}/{careTasks.length}</span></div><ul className="action-list">{careTasks.map((task) => <li key={task.id}><button type="button" className={`check ${completedTasks.includes(task.id) ? 'is-complete' : ''}`} onClick={() => toggle(task.id, completedTasks, setCompletedTasks)}><span aria-hidden="true">{completedTasks.includes(task.id) ? 'Done' : 'Mark'}</span><span><strong>{task.title}</strong><small>{task.detail}</small></span></button></li>)}</ul></section></div></section>
    <aside className="upcoming" aria-label="Later this week"><span className="upcoming-label">Later this week</span><strong>{appointments[1].time} with {appointments[1].clinician}</strong><span>{appointments[1].location}</span><button type="button" className="quiet-action">View details</button></aside>
  </>
}