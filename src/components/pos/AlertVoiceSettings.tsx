"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getPreferredVoiceURI,
  loadVoices,
  setPreferredVoiceURI,
  speakWithVoice,
} from "@/lib/pos/notificationSound";

import { PosBackLink } from "./PosBackLink";

/**
 * Lets the shop pick, by ear, which installed voice speaks the "You have a new order" alert on
 * *this device* — see `notificationSound.ts`'s comment on why this exists at all: the Web
 * Speech API has no gender field, so the automatic "find a female English voice" guess can only
 * match on a voice's name, and some devices (commonly Android/Chrome) ship a single voice for a
 * given language with an internal, non-descriptive name that guess can never recognize as
 * female. Stored in `localStorage`, per device — a tablet at the register may have different
 * voices installed than a phone in the kitchen, so this is deliberately not a shop-wide
 * `ShopSettings` value.
 */
export function AlertVoiceSettings() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  // Read once as the initial value (not set inside an effect body) — `localStorage` is a plain
  // synchronous read, so there's no external subscription here to justify an effect for it.
  const [selectedURI, setSelectedURI] = useState<string | null>(() => getPreferredVoiceURI());

  useEffect(() => {
    loadVoices(setVoices);
  }, []);

  function choose(voice: SpeechSynthesisVoice) {
    setPreferredVoiceURI(voice.voiceURI);
    setSelectedURI(voice.voiceURI);
  }

  function resetToAutomatic() {
    setPreferredVoiceURI(null);
    setSelectedURI(null);
  }

  // English-tagged voices first (the ones actually likely to pronounce the phrase correctly),
  // then everything else — some devices mislabel or omit a voice's language tag entirely, so
  // showing every voice (with a "ทดสอบ" button) is what actually lets the shop find it by ear.
  const sorted = voices
    ? [...voices].sort((a, b) => Number(b.lang.toLowerCase().startsWith("en")) - Number(a.lang.toLowerCase().startsWith("en")))
    : null;

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <PosBackLink />
      <h1 className="mb-1 text-lg font-semibold">เสียงแจ้งเตือนออเดอร์ใหม่</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        กด &quot;ทดสอบ&quot; ฟังแต่ละเสียง แล้วกด &quot;เลือกใช้เสียงนี้&quot; สำหรับเสียงที่ชอบ —
        ตั้งค่าแยกเฉพาะเครื่องนี้เท่านั้น (เครื่องอื่นต้องเลือกแยกกัน)
      </p>

      <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-card p-3">
        <div>
          <p className="font-medium">อัตโนมัติ (ค้นหาเสียงผู้หญิงภาษาอังกฤษให้เอง)</p>
          <p className="text-xs text-muted-foreground">ค่าเริ่มต้น — ถ้ายังไม่เคยเลือกเสียงเอง</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedURI === null ? <Badge variant="success">กำลังใช้อยู่</Badge> : null}
          <Button variant="outline" size="sm" onClick={resetToAutomatic} disabled={selectedURI === null}>
            ใช้แบบนี้
          </Button>
        </div>
      </div>

      {sorted === null ? (
        <p className="text-sm text-muted-foreground">กำลังโหลดรายชื่อเสียง...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">เครื่องนี้ไม่มีเสียงพูดให้เลือก (ไม่รองรับ Text-to-Speech)</p>
      ) : (
        <div className="grid gap-2">
          {sorted.map((voice) => (
            <div
              key={voice.voiceURI}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{voice.name}</p>
                <p className="text-xs text-muted-foreground">{voice.lang}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedURI === voice.voiceURI ? <Badge variant="success">กำลังใช้อยู่</Badge> : null}
                <Button variant="outline" size="sm" onClick={() => speakWithVoice(voice)}>
                  ทดสอบ
                </Button>
                <Button
                  size="sm"
                  onClick={() => choose(voice)}
                  disabled={selectedURI === voice.voiceURI}
                >
                  เลือกใช้เสียงนี้
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
