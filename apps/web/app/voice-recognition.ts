export type SpeechRecognitionResultLike = { [index: number]: { transcript: string } };
export type SpeechRecognitionEventLike = Event & {
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
export type SpeechRecognitionErrorLike = Event & { error?: string };
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
};
