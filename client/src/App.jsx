import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const API = 'https://mailbot-production-78f1.up.railway.app'

export default function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    { role: 'ai', text: "Hi! I'm MailBot. Tell me who to email and what to say." }
  ])
  const [connected, setConnected] = useState(false)
  const [userEmail, setUserEmail] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editTo, setEditTo] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [toError, setToError] = useState(false)
  const [subjectError, setSubjectError] = useState(false)
  const [bodyError, setBodyError] = useState(false)
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [waitingConfirm, setWaitingConfirm] = useState(false)
  const [scheduledList, setScheduledList] = useState([])
  const [showScheduled, setShowScheduled] = useState(false)
  const [feedback, setFeedback] = useState({ show: false, rating: 0, comment: '', sent: false })
  const [undoCountdown, setUndoCountdown] = useState(0)
  const [pendingEmail, setPendingEmail] = useState(null)
  const recognitionRef = useRef(null)
  const messagesEndRef = useRef(null)
  const undoRef = useRef(null)

  useEffect(() => {
    // Check auth status and get user email
    axios.get(`${API}/auth/status`, { withCredentials: true })
      .then(res => {
        setConnected(res.data.connected)
        if (res.data.email) setUserEmail(res.data.email)
      })

    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      setConnected(true)
      setMessages(prev => [...prev, {
        role: 'ai', text: '✅ Gmail connected! Now tell me who to email and what to say.'
      }])
      window.history.replaceState({}, '', '/')
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, draft, undoCountdown])

  useEffect(() => {
    return () => { if (undoRef.current) clearInterval(undoRef.current) }
  }, [])

  const fetchScheduled = async () => {
    const res = await axios.get(`${API}/email/scheduled`, { withCredentials: true })
    setScheduledList(res.data.scheduled)
  }

  const speak = (text) => new Promise((resolve) => {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 1
    utterance.onend = resolve
    window.speechSynthesis.speak(utterance)
  })

  const showNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' })
    }
  }

  const listenForConfirmation = () => new Promise((resolve) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => resolve(e.results[0][0].transcript.toLowerCase().trim())
    rec.onerror = () => resolve('no')
    rec.onend = () => resolve('no')
    rec.start()
  })

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice input not supported. Please use Chrome!')
      return
    }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onresult = (e) => {
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript
      }
      if (final) setInput(prev => prev + final)
    }
    recognition.onerror = () => setListening(false)
    recognition.start()
  }

  const sendMessage = async (overrideMsg) => {
    const userMsg = overrideMsg || input
    if (!userMsg.trim()) return
    setInput('')
    setDraft(null)
    setEditing(false)
    setScheduleTime('')
    setWaitingConfirm(false)
    setToError(false)
    setSubjectError(false)
    setBodyError(false)
    window.speechSynthesis.cancel()
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)
    setMessages(prev => [...prev, { role: 'ai', text: '✍️ Drafting your email...' }])
    try {
      const res = await axios.post(`${API}/email/draft`, { userMessage: userMsg }, { withCredentials: true })
      const d = res.data.draft
      setDraft(d)
      setEditTo(d.to)
      setEditSubject(d.subject)
      setEditBody(d.body)
      setMessages(prev => prev.slice(0, -1))
      setMessages(prev => [...prev, { role: 'ai', text: "Here's your email draft 👇" }])
      setLoading(false)
      await speakAndConfirm(d)
    } catch (err) {
      setMessages(prev => prev.slice(0, -1))
      setMessages(prev => [...prev, { role: 'ai', text: '❌ Something went wrong. Try again!' }])
      setLoading(false)
    }
  }

  const speakAndConfirm = async (d) => {
    setWaitingConfirm(true)
    await speak(`Here's your email. To: ${d.to}. Subject: ${d.subject}. Do you want me to send this? Say yes to send or no to cancel.`)
    const answer = await listenForConfirmation()
    setWaitingConfirm(false)
    window.speechSynthesis.cancel()
    if (answer.includes('yes') || answer.includes('yeah') || answer.includes('yep') || answer.includes('send')) {
      await speak('Starting 30 second undo timer. Click undo to cancel.')
      sendEmail(d)
    } else {
      await speak('Okay, cancelled. You can edit, schedule, or discard the draft.')
      setMessages(prev => [...prev, { role: 'ai', text: '🚫 Cancelled. Edit, schedule, or discard below.' }])
    }
  }

  const isValidEmail = (email) => {
    if (!email) return false
    const trimmed = email.trim()
    const parts = trimmed.split('@')
    if (parts.length !== 2) return false
    const [local, domain] = parts
    if (!local || local.length === 0) return false
    const domainParts = domain.split('.')
    if (domainParts.length < 2) return false
    const tld = domainParts[domainParts.length - 1]
    if (tld.length < 2) return false
    if (!domainParts[0] || domainParts[0].length === 0) return false
    if (trimmed.includes(' ')) return false
    return true
  }

  const validateEmail = (emailToSend) => {
    setToError(false)
    setSubjectError(false)
    setBodyError(false)

    if (!isValidEmail(emailToSend.to)) {
      setToError(true)
      setEditing(true)
      setMessages(prev => [...prev, {
        role: 'ai',
        text: `❌ "${emailToSend.to}" is not a valid email address. It must include @ and a proper domain like gmail.com`
      }])
      speak('That email address is invalid. Please check it and try again.')
      return false
    }
    if (!emailToSend.subject || emailToSend.subject.trim() === '') {
      setSubjectError(true)
      setEditing(true)
      setMessages(prev => [...prev, {
        role: 'ai',
        text: '❌ Subject line is empty. Please add a subject before sending!'
      }])
      speak('The subject line is empty. Please add a subject.')
      return false
    }
    if (!emailToSend.body || emailToSend.body.trim() === '') {
      setBodyError(true)
      setEditing(true)
      setMessages(prev => [...prev, {
        role: 'ai',
        text: '❌ Email body is empty. Please write something before sending!'
      }])
      speak('The email body is empty. Please write something.')
      return false
    }
    return true
  }

  const sendEmail = (overrideDraft) => {
    const emailToSend = overrideDraft
      ? { to: overrideDraft.to, subject: overrideDraft.subject, body: overrideDraft.body }
      : { to: editTo, subject: editSubject, body: editBody }

    if (!validateEmail(emailToSend)) return

    setPendingEmail(emailToSend)
    setDraft(null)
    setEditing(false)
    setScheduleTime('')
    setWaitingConfirm(false)
    setUndoCountdown(30)
    setToError(false)
    setSubjectError(false)
    setBodyError(false)

    setMessages(prev => [...prev, {
      role: 'ai',
      text: `⏳ Sending to ${emailToSend.to} in 30 seconds... click Undo to cancel!`
    }])

    let count = 30
    undoRef.current = setInterval(() => {
      count--
      setUndoCountdown(count)
      if (count <= 0) {
        clearInterval(undoRef.current)
        undoRef.current = null
        setUndoCountdown(0)
        setPendingEmail(null)
        actuallySendEmail(emailToSend)
      }
    }, 1000)
  }

  const undoSend = () => {
    if (undoRef.current) {
      clearInterval(undoRef.current)
      undoRef.current = null
    }
    setPendingEmail(null)
    setUndoCountdown(0)
    window.speechSynthesis.cancel()
    setMessages(prev => {
      const filtered = prev.filter(m => !(m.text.includes('Sending to') && m.text.includes('seconds')))
      return [...filtered, { role: 'ai', text: '↩️ Email cancelled! It was not sent.' }]
    })
    speak('Email cancelled!')
  }

  const actuallySendEmail = async (emailToSend) => {
    setSending(true)
    try {
      await axios.post(`${API}/email/send`, emailToSend, { withCredentials: true })
      setMessages(prev => {
        const filtered = prev.filter(m => !m.text.includes('seconds... click Undo'))
        return [...filtered, { role: 'ai', text: `✅ Email sent to ${emailToSend.to}! 🎉` }]
      })
      await speak('Email sent successfully!')
      showNotification('✅ Email Sent!', `Your email to ${emailToSend.to} was sent successfully.`)
      setFeedback({ show: true, rating: 0, comment: '', sent: false })
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Failed to send. Try again!'
      setMessages(prev => [...prev, { role: 'ai', text: `❌ ${errMsg}` }])
      await speak('Sorry, failed to send. Please check the email address and try again.')
    }
    setSending(false)
  }

  const scheduleEmail = async () => {
    if (!scheduleTime) return alert('Please pick a date and time first!')
    const emailToSend = { to: editTo, subject: editSubject, body: editBody }
    if (!validateEmail(emailToSend)) return
    setWaitingConfirm(false)
    window.speechSynthesis.cancel()
    setScheduling(true)
    try {
      await axios.post(`${API}/email/schedule`, {
        to: editTo, subject: editSubject, body: editBody,
        sendAt: scheduleTime, createdBy: userEmail
      }, { withCredentials: true })
      setDraft(null)
      setEditing(false)
      setScheduleTime('')
      const when = new Date(scheduleTime).toLocaleString()
      setMessages(prev => [...prev, {
        role: 'ai', text: `⏰ Scheduled! Your email to ${editTo} will be sent on ${when}`
      }])
      await speak(`Email scheduled for ${when}`)
      showNotification('⏰ Email Scheduled!', `Your email to ${editTo} is scheduled for ${when}`)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: '❌ Failed to schedule. Try again!' }])
    }
    setScheduling(false)
  }

  const deleteScheduled = async (id) => {
    await axios.delete(`${API}/email/scheduled/${id}`, { withCredentials: true })
    fetchScheduled()
  }

  const submitFeedback = async () => {
    if (feedback.rating === 0) return alert('Please select a star rating!')
    await axios.post(`${API}/email/feedback`, {
      rating: feedback.rating, comment: feedback.comment
    }, { withCredentials: true })
    setFeedback(prev => ({ ...prev, sent: true }))
    setTimeout(() => setFeedback({ show: false, rating: 0, comment: '', sent: false }), 2000)
  }

  const minDateTime = new Date(Date.now() + 5 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  const progressWidth = `${(undoCountdown / 30) * 100}%`

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d14; font-family: 'DM Sans', sans-serif; min-height: 100vh; }
        .app-bg { min-height: 100vh; background: radial-gradient(ellipse 60% 40% at 20% 10%, rgba(108,99,255,0.12) 0%, transparent 70%), radial-gradient(ellipse 50% 50% at 80% 80%, rgba(255,107,157,0.07) 0%, transparent 70%); }
        .wrapper { max-width: 680px; margin: 0 auto; padding: 32px 20px 120px; display: flex; flex-direction: column; min-height: 100vh; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #6c63ff, #ff6b9d); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .logo-text { font-family: 'Syne', sans-serif; font-size: 1.4rem; font-weight: 800; color: #f0f0f8; letter-spacing: -0.5px; }
        .logo-text span { background: linear-gradient(90deg, #6c63ff, #ff6b9d); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .header-right { display: flex; align-items: center; gap: 10px; }
        .gmail-badge { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 50px; font-size: 12px; font-weight: 500; }
        .gmail-badge.connected { background: rgba(52,199,89,0.12); border: 1px solid rgba(52,199,89,0.3); color: #34c759; }
        .gmail-badge.disconnected { background: rgba(108,99,255,0.12); border: 1px solid rgba(108,99,255,0.3); color: #6c63ff; text-decoration: none; cursor: pointer; transition: all 0.2s; }
        .badge-dot { width: 7px; height: 7px; border-radius: 50%; background: #34c759; animation: blink 2s infinite; }
        .user-email { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 2px; }
        .scheduled-btn { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); border-radius: 50px; padding: 8px 14px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .scheduled-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .confirm-banner { background: rgba(255,107,157,0.08); border: 1px solid rgba(255,107,157,0.3); border-radius: 14px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; animation: fadeIn 0.3s ease; }
        .confirm-banner-icon { font-size: 24px; animation: pulse 1s infinite; }
        .confirm-banner-text { font-size: 13px; color: #ff6b9d; font-weight: 500; line-height: 1.5; }
        .undo-banner { background: rgba(255,149,0,0.08); border: 1px solid rgba(255,149,0,0.3); border-radius: 14px; padding: 14px 18px; margin-bottom: 16px; animation: fadeIn 0.3s ease; }
        .undo-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .undo-left { display: flex; align-items: center; gap: 12px; }
        .undo-title { font-size: 13px; color: #ff9500; font-weight: 600; }
        .undo-sub { font-size: 11px; color: rgba(255,149,0,0.6); margin-top: 2px; }
        .undo-btn { background: rgba(255,149,0,0.15); border: 1px solid rgba(255,149,0,0.4); color: #ff9500; border-radius: 10px; padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: all 0.2s; }
        .undo-btn:hover { background: rgba(255,149,0,0.25); transform: scale(1.02); }
        .undo-progress-track { height: 4px; background: rgba(255,149,0,0.15); border-radius: 2px; margin-top: 12px; overflow: hidden; }
        .undo-progress-bar { height: 100%; background: linear-gradient(90deg, #ff9500, #ffb347); border-radius: 2px; transition: width 1s linear; }
        .messages { flex: 1; display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
        .msg-row { display: flex; align-items: flex-end; gap: 8px; animation: fadeUp 0.3s ease; }
        .msg-row.user { flex-direction: row-reverse; }
        .msg-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
        .msg-avatar.ai { background: linear-gradient(135deg, #6c63ff, #ff6b9d); }
        .msg-avatar.user { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); }
        .bubble { max-width: 75%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; }
        .bubble.ai { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #d0d0e0; border-bottom-left-radius: 4px; }
        .bubble.user { background: linear-gradient(135deg, #6c63ff, #5a52d5); color: #fff; border-bottom-right-radius: 4px; }
        .draft-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(108,99,255,0.35); border-radius: 18px; padding: 20px; margin-top: 4px; animation: fadeUp 0.3s ease; }
        .draft-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .draft-label { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700; color: #6c63ff; text-transform: uppercase; letter-spacing: 1.5px; }
        .edit-btn { background: none; border: 1px solid rgba(108,99,255,0.4); color: #6c63ff; border-radius: 8px; padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .edit-btn:hover { background: rgba(108,99,255,0.1); }
        .cancel-btn { background: none; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.4); border-radius: 8px; padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .draft-field { margin-bottom: 12px; }
        .field-label { font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
        .field-value { font-size: 13px; color: #d0d0e0; line-height: 1.6; }
        .field-divider { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 12px 0; }
        .field-input { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(108,99,255,0.3); border-radius: 8px; padding: 9px 12px; color: #f0f0f8; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.2s; }
        .field-input.error { border-color: #ff3b30 !important; background: rgba(255,59,48,0.06); }
        .field-textarea { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(108,99,255,0.3); border-radius: 8px; padding: 9px 12px; color: #f0f0f8; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; resize: vertical; line-height: 1.6; transition: border-color 0.2s; }
        .field-textarea.error { border-color: #ff3b30 !important; background: rgba(255,59,48,0.06); }
        .error-hint { font-size: 11px; color: #ff3b30; margin-top: 4px; }
        .schedule-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .schedule-label { font-size: 11px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .datetime-input { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(108,99,255,0.3); border-radius: 8px; padding: 9px 12px; color: #f0f0f8; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; color-scheme: dark; }
        .draft-actions { display: flex; gap: 8px; margin-top: 16px; }
        .btn-send { flex: 1; background: linear-gradient(135deg, #34c759, #28a745); color: #fff; border: none; border-radius: 12px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .btn-send:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(52,199,89,0.3); }
        .btn-send:disabled { background: rgba(255,255,255,0.1); cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-schedule { flex: 1; background: linear-gradient(135deg, #ff9500, #e07800); color: #fff; border: none; border-radius: 12px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .btn-schedule:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255,149,0,0.3); }
        .btn-schedule:disabled { background: rgba(255,255,255,0.1); cursor: not-allowed; }
        .btn-done { flex: 1; background: linear-gradient(135deg, #6c63ff, #5a52d5); color: #fff; border: none; border-radius: 12px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-discard { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); border-radius: 12px; padding: 12px 16px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .btn-discard:hover { background: rgba(255,59,48,0.1); border-color: rgba(255,59,48,0.3); color: #ff3b30; }
        .input-area { position: fixed; bottom: 0; left: 0; right: 0; padding: 16px 20px 24px; background: linear-gradient(to top, #0d0d14 60%, transparent); }
        .input-inner { max-width: 680px; margin: 0 auto; display: flex; gap: 10px; align-items: center; }
        .mic-btn { width: 48px; height: 48px; border-radius: 14px; border: 1.5px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); font-size: 20px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .mic-btn.listening { border-color: #ff6b9d; background: rgba(255,107,157,0.12); animation: pulse 1s infinite; }
        .text-input { flex: 1; background: rgba(255,255,255,0.06); border: 1.5px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 13px 18px; color: #f0f0f8; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.2s; }
        .text-input:focus { border-color: rgba(108,99,255,0.5); }
        .text-input::placeholder { color: rgba(255,255,255,0.25); }
        .text-input:disabled { opacity: 0.4; }
        .send-btn { width: 48px; height: 48px; border-radius: 14px; border: none; background: linear-gradient(135deg, #6c63ff, #5a52d5); color: #fff; font-size: 18px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .send-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(108,99,255,0.4); }
        .send-btn:disabled { background: rgba(255,255,255,0.1); cursor: not-allowed; }
        .typing-dots span { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.4); margin: 0 2px; animation: bounce 1.2s infinite; }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.2s ease; padding: 20px; }
        .modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 24px; width: 100%; max-width: 440px; max-height: 80vh; overflow-y: auto; }
        .modal-title { font-family: 'Syne', sans-serif; font-size: 1.1rem; font-weight: 700; color: #f0f0f8; margin-bottom: 20px; }
        .scheduled-item { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .scheduled-info { flex: 1; }
        .scheduled-to { font-size: 13px; color: #f0f0f8; font-weight: 500; margin-bottom: 3px; }
        .scheduled-subject { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 5px; }
        .scheduled-time { font-size: 11px; color: #ff9500; }
        .scheduled-delete { background: none; border: 1px solid rgba(255,59,48,0.3); color: #ff3b30; border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .feedback-modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 28px; width: 100%; max-width: 380px; text-align: center; }
        .feedback-title { font-family: 'Syne', sans-serif; font-size: 1.1rem; font-weight: 700; color: #f0f0f8; margin-bottom: 6px; }
        .feedback-sub { font-size: 13px; color: rgba(255,255,255,0.4); margin-bottom: 20px; }
        .stars { display: flex; justify-content: center; gap: 8px; margin-bottom: 16px; }
        .star { font-size: 32px; cursor: pointer; transition: transform 0.1s; opacity: 0.3; }
        .star.active { opacity: 1; }
        .star:hover { transform: scale(1.2); opacity: 1; }
        .feedback-input { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 10px 14px; color: #f0f0f8; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; resize: none; margin-bottom: 14px; }
        .feedback-actions { display: flex; gap: 8px; }
        .btn-submit { flex: 1; background: linear-gradient(135deg, #6c63ff, #5a52d5); color: #fff; border: none; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-skip { background: none; border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.4); border-radius: 10px; padding: 11px 16px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,157,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,107,157,0); } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
      `}</style>

      <div className="app-bg">
        <div className="wrapper">

          {/* Header */}
          <div className="header">
            <div className="logo">
              <div className="logo-icon">✉️</div>
              <div className="logo-text">Mail<span>Bot</span></div>
            </div>
            <div className="header-right">
              <button className="scheduled-btn" onClick={() => { setShowScheduled(true); fetchScheduled(); }}>
                ⏰ Scheduled
              </button>
              {connected ? (
                <div className="gmail-badge connected">
                  <div className="badge-dot" />
                  <div>
                    <div>Gmail connected</div>
                    {userEmail && <div className="user-email">{userEmail}</div>}
                  </div>
                </div>
              ) : (
                <a href={`${API}/auth/google`} className="gmail-badge disconnected">🔗 Connect Gmail</a>
              )}
            </div>
          </div>

          {/* Voice confirmation banner */}
          {waitingConfirm && (
            <div className="confirm-banner">
              <span className="confirm-banner-icon">🎙️</span>
              <div className="confirm-banner-text">
                Listening for confirmation...<br />
                Say <strong>"Yes"</strong> to send or <strong>"No"</strong> to cancel
                <br />
                <span
                  style={{ fontSize: 11, color: 'rgba(255,107,157,0.6)', cursor: 'pointer', textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}
                  onClick={() => { setWaitingConfirm(false); window.speechSynthesis.cancel(); }}
                >
                  Click here to dismiss
                </span>
              </div>
            </div>
          )}

          {/* Undo send banner */}
          {undoCountdown > 0 && (
            <div className="undo-banner">
              <div className="undo-top">
                <div className="undo-left">
                  <span style={{ fontSize: 24 }}>⏳</span>
                  <div>
                    <div className="undo-title">Sending in {undoCountdown} seconds...</div>
                    <div className="undo-sub">Click Undo to cancel before it sends</div>
                  </div>
                </div>
                <button className="undo-btn" onClick={undoSend}>↩️ Undo</button>
              </div>
              <div className="undo-progress-track">
                <div className="undo-progress-bar" style={{ width: progressWidth }} />
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`msg-row ${m.role}`}>
                <div className={`msg-avatar ${m.role}`}>{m.role === 'ai' ? '🤖' : '👤'}</div>
                <div className={`bubble ${m.role}`}>
                  {m.text === '✍️ Drafting your email...' ? (
                    <div className="typing-dots"><span /><span /><span /></div>
                  ) : m.text}
                </div>
              </div>
            ))}

            {/* Draft card */}
            {draft && (
              <div className="draft-card">
                <div className="draft-header">
                  <div className="draft-label">✉️ Email Draft</div>
                  {!editing ? (
                    <button className="edit-btn" onClick={() => setEditing(true)}>✏️ Edit</button>
                  ) : (
                    <button className="cancel-btn" onClick={() => { setEditing(false); setToError(false); setSubjectError(false); setBodyError(false); }}>Cancel</button>
                  )}
                </div>

                <div className="draft-field">
                  <div className="field-label">To</div>
                  {editing ? (
                    <>
                      <input className={`field-input ${toError ? 'error' : ''}`} value={editTo} onChange={e => { setEditTo(e.target.value); setToError(false) }} placeholder="recipient@email.com" />
                      {toError && <div className="error-hint">⚠️ Must be a valid email like name@domain.com</div>}
                    </>
                  ) : (
                    <div className="field-value" style={{ color: toError ? '#ff3b30' : '#d0d0e0' }}>{editTo}</div>
                  )}
                </div>

                <div className="draft-field">
                  <div className="field-label">Subject</div>
                  {editing ? (
                    <>
                      <input className={`field-input ${subjectError ? 'error' : ''}`} value={editSubject} onChange={e => { setEditSubject(e.target.value); setSubjectError(false) }} placeholder="Email subject" />
                      {subjectError && <div className="error-hint">⚠️ Subject cannot be empty</div>}
                    </>
                  ) : (
                    <div className="field-value">{editSubject}</div>
                  )}
                </div>

                <hr className="field-divider" />

                <div className="draft-field">
                  <div className="field-label">Message</div>
                  {editing ? (
                    <>
                      <textarea className={`field-textarea ${bodyError ? 'error' : ''}`} rows={5} value={editBody} onChange={e => { setEditBody(e.target.value); setBodyError(false) }} placeholder="Email body" />
                      {bodyError && <div className="error-hint">⚠️ Message cannot be empty</div>}
                    </>
                  ) : (
                    <div className="field-value" style={{ whiteSpace: 'pre-wrap' }}>{editBody}</div>
                  )}
                </div>

                <div className="schedule-section">
                  <div className="schedule-label">⏰ Schedule for later (optional)</div>
                  <input type="datetime-local" className="datetime-input" value={scheduleTime} min={minDateTime} onChange={e => setScheduleTime(e.target.value)} />
                </div>

                <div className="draft-actions">
                  {editing ? (
                    <button className="btn-done" onClick={() => { setEditing(false); setToError(false); setSubjectError(false); setBodyError(false); }}>✅ Done Editing</button>
                  ) : scheduleTime ? (
                    <button className="btn-schedule" onClick={scheduleEmail} disabled={scheduling}>
                      {scheduling ? '⏳ Scheduling...' : '⏰ Schedule Email'}
                    </button>
                  ) : (
                    <button className="btn-send" onClick={() => sendEmail()} disabled={sending}>
                      {sending ? '📤 Sending...' : '📤 Send Now'}
                    </button>
                  )}
                  <button className="btn-discard" onClick={() => {
                    setDraft(null); setEditing(false); setScheduleTime('')
                    setWaitingConfirm(false); setToError(false); setSubjectError(false)
                    setBodyError(false); window.speechSynthesis.cancel()
                  }}>🗑️</button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Fixed input bar */}
        <div className="input-area">
          <div className="input-inner">
            <button className={`mic-btn ${listening ? 'listening' : ''}`} onClick={toggleVoice}>🎙️</button>
            <input
              className="text-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && !waitingConfirm && sendMessage()}
              placeholder={
                listening ? '🎙️ Listening... click mic to stop' :
                waitingConfirm ? 'Say "Yes" or "No"...' :
                undoCountdown > 0 ? `↩️ ${undoCountdown}s — click Undo above to cancel` :
                connected ? 'Who do you want to email and about what?' : 'Connect Gmail first ↑'
              }
              disabled={!connected || loading || waitingConfirm}
            />
            <button className="send-btn" onClick={() => sendMessage()} disabled={!connected || loading || waitingConfirm}>➤</button>
          </div>
        </div>

        {/* Scheduled emails modal */}
        {showScheduled && (
          <div className="modal-overlay" onClick={() => setShowScheduled(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">⏰ Scheduled Emails</div>
              {scheduledList.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  No scheduled emails yet.<br />Pick a date and time on a draft to schedule one!
                </div>
              ) : scheduledList.map(e => (
                <div key={e.id} className="scheduled-item">
                  <div className="scheduled-info">
                    <div className="scheduled-to">To: {e.to}</div>
                    <div className="scheduled-subject">{e.subject}</div>
                    <div className="scheduled-time">⏰ {new Date(e.sendAt).toLocaleString()}</div>
                  </div>
                  <button className="scheduled-delete" onClick={() => deleteScheduled(e.id)}>Cancel</button>
                </div>
              ))}
              <button onClick={() => setShowScheduled(false)} style={{ marginTop: 16, width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 10, padding: 10, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                Close
              </button>
            </div>
          </div>
        )}

        {/* Feedback modal */}
        {feedback.show && (
          <div className="modal-overlay">
            <div className="feedback-modal">
              {feedback.sent ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                  <div className="feedback-title">Thanks for your feedback!</div>
                </>
              ) : (
                <>
                  <div className="feedback-title">How was that?</div>
                  <div className="feedback-sub">Rate your MailBot experience</div>
                  <div className="stars">
                    {[1,2,3,4,5].map(s => (
                      <span key={s} className={`star ${s <= feedback.rating ? 'active' : ''}`} onClick={() => setFeedback(prev => ({ ...prev, rating: s }))}>⭐</span>
                    ))}
                  </div>
                  <textarea className="feedback-input" rows={3} placeholder="Any comments? (optional)" value={feedback.comment} onChange={e => setFeedback(prev => ({ ...prev, comment: e.target.value }))} />
                  <div className="feedback-actions">
                    <button className="btn-submit" onClick={submitFeedback}>Submit ⭐</button>
                    <button className="btn-skip" onClick={() => setFeedback({ show: false, rating: 0, comment: '', sent: false })}>Skip</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}