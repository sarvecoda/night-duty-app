import { useState, useEffect } from 'react'
import './MonthYearPicker.css'

interface MonthYearPickerProps {
  value: string
  onChange: (monthYear: string) => void
  label?: string
}

function MonthYearPicker({ value, onChange, label }: MonthYearPickerProps) {
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1)

  useEffect(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number)
      if (y && m) {
        setYear(y)
        setMonth(m)
      }
    }
  }, [value])

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = parseInt(e.target.value)
    setYear(newYear)
    onChange(`${newYear}-${String(month).padStart(2, '0')}`)
  }

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = parseInt(e.target.value)
    setMonth(newMonth)
    onChange(`${year}-${String(newMonth).padStart(2, '0')}`)
  }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)

  return (
    <div className="month-year-picker">
      {label && <label className="picker-label">{label}</label>}
      <div className="picker-controls">
        <select className="input picker-select" value={month} onChange={handleMonthChange}>
          {months.map((monthName, index) => (
            <option key={index + 1} value={index + 1}>
              {monthName}
            </option>
          ))}
        </select>
        <select className="input picker-select" value={year} onChange={handleYearChange}>
          {years.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default MonthYearPicker

