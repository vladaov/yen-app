import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email, password, name) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // ── MFA / TOTP ──────────────────────────────────────────────

  /**
   * Returns true if the current user has at least one verified TOTP factor.
   */
  async function isMFAEnabled() {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) throw error
    return data.totp.some((f) => f.status === 'verified')
  }

  /**
   * Begins TOTP enrollment.
   * Returns { id, qr_code, secret } — show the QR code to the user.
   */
  async function enableMFA() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (error) throw error
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    }
  }

  /**
   * Verifies the TOTP code entered by the user and completes enrollment.
   * Call this after enableMFA() with the factorId returned by it.
   */
  async function verifyMFA(factorId, code) {
    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) throw challengeError

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    })
    if (verifyError) throw verifyError
  }

  /**
   * Unenrolls (disables) a TOTP factor.
   */
  async function disableMFA(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) throw error
  }

  /**
   * Lists all MFA factors for the current user.
   */
  async function listMFAFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) throw error
    return data.totp
  }

  return {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    // MFA
    isMFAEnabled,
    enableMFA,
    verifyMFA,
    disableMFA,
    listMFAFactors,
  }
}
