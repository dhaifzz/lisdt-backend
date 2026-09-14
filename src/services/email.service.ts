import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  const verifyLink = `${appUrl}/verify-email?token=${token}`
  
  // Use path.resolve to find the logo in the frontend folder relative to the backend running directory
  const logoPath = path.resolve(process.cwd(), '../frontend/src/assets/Lisdt.png')

  const mailOptions = {
    from: `"Lisdt" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Verify your Lisdt account',
    html: `
      <div style="font-family: 'Courier New', Courier, monospace; max-width: 600px; margin: 0 auto; background-color: #080808; color: #e5e5e5; padding: 40px; border-radius: 12px; border: 1px solid #27272a;">
        
        <!-- Header with Logo -->
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="cid:lisdt-logo" alt="Lisdt Logo" style="width: 80px; height: 80px; margin-bottom: 15px; filter: drop-shadow(0 0 10px rgba(255,255,255,0.1));" />
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">Lisdt</h1>
          <p style="color: #52525b; font-size: 12px; margin-top: 5px; letter-spacing: 1px;">// SECURE GATE</p>
        </div>

        <hr style="border: none; border-top: 1px solid #27272a; margin-bottom: 30px;" />

        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px; text-align: center;">
          Access requested. Please verify your email address to initialize your media diary profile.
        </p>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 40px 0;">
          <a href="${verifyLink}" style="display: inline-block; background-color: #ffffff; color: #000000; padding: 16px 32px; text-decoration: none; font-weight: bold; border-radius: 4px; font-size: 14px; letter-spacing: 1px;">
            VERIFY_ACCOUNT &rarr;
          </a>
        </div>

        <!-- Fallback Link -->
        <div style="background-color: #0c0c0c; padding: 15px; border-radius: 6px; border: 1px dashed #27272a; text-align: center; margin-bottom: 40px;">
          <p style="font-size: 11px; color: #71717a; margin-bottom: 8px;">OR INITIATE MANUAL OVERRIDE (COPY LINK):</p>
          <a href="${verifyLink}" style="color: #10b981; font-size: 11px; word-break: break-all;">${verifyLink}</a>
        </div>

        <hr style="border: none; border-top: 1px solid #27272a; margin-bottom: 20px;" />
        
        <p style="font-size: 10px; color: #52525b; text-align: center; margin: 0;">
          If you did not request this authorization, you can safely ignore this transmission.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: 'Lisdt.png',
        path: logoPath,
        cid: 'lisdt-logo', // same cid value as in the html img src
      }
    ]
  }

  await transporter.sendMail(mailOptions)
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  const resetLink = `${appUrl}/reset-password?token=${token}`
  
  const logoPath = path.resolve(process.cwd(), '../frontend/src/assets/Lisdt.png')

  const mailOptions = {
    from: `"Lisdt" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Reset your Lisdt account password',
    html: `
      <div style="font-family: 'Courier New', Courier, monospace; max-width: 600px; margin: 0 auto; background-color: #080808; color: #e5e5e5; padding: 40px; border-radius: 12px; border: 1px solid #27272a;">
        
        <!-- Header with Logo -->
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="cid:lisdt-logo" alt="Lisdt Logo" style="width: 80px; height: 80px; margin-bottom: 15px; filter: drop-shadow(0 0 10px rgba(255,255,255,0.1));" />
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">Lisdt</h1>
          <p style="color: #52525b; font-size: 12px; margin-top: 5px; letter-spacing: 1px;">PASSWORD RECOVERY</p>
        </div>

        <hr style="border: none; border-top: 1px solid #27272a; margin-bottom: 30px;" />

        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px; text-align: center;">
          A password reset was requested for your media diary account. Click below to establish a new password.
        </p>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 40px 0;">
          <a href="${resetLink}" style="display: inline-block; background-color: #ffffff; color: #000000; padding: 16px 32px; text-decoration: none; font-weight: bold; border-radius: 4px; font-size: 14px; letter-spacing: 1px;">
            RESET_PASSWORD &rarr;
          </a>
        </div>

        <!-- Fallback Link -->
        <div style="background-color: #0c0c0c; padding: 15px; border-radius: 6px; border: 1px dashed #27272a; text-align: center; margin-bottom: 40px;">
          <p style="font-size: 11px; color: #71717a; margin-bottom: 8px;">OR INITIATE MANUAL OVERRIDE (COPY LINK):</p>
          <a href="${resetLink}" style="color: #10b981; font-size: 11px; word-break: break-all;">${resetLink}</a>
        </div>

        <p style="font-size: 11px; color: #ef4444; text-align: center; margin-bottom: 20px;">
          * Security Notice: This link expires in 1 hour.
        </p>

        <hr style="border: none; border-top: 1px solid #27272a; margin-bottom: 20px;" />
        
        <p style="font-size: 10px; color: #52525b; text-align: center; margin: 0;">
          If you did not request a password reset, you can safely disregard this transmission.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: 'Lisdt.png',
        path: logoPath,
        cid: 'lisdt-logo',
      }
    ]
  }

  await transporter.sendMail(mailOptions)
}
