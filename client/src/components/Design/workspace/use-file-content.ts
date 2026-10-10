import { useEffect, useState } from 'react';
import { useDesignFileContentQuery } from '../api/queries';

export function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export function useFileText(projectId: string, path: string) {
  const query = useDesignFileContentQuery({ projectId, path });
  const blob = query.data?.blob;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setText(null);
      return;
    }
    let active = true;
    readBlobText(blob).then(
      (value) => active && setText(value),
      () => active && setText(''),
    );
    return () => {
      active = false;
    };
  }, [blob]);

  return { ...query, text };
}

export function useFileObjectUrl(projectId: string, path: string) {
  const query = useDesignFileContentQuery({ projectId, path });
  const blob = query.data?.blob;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return { ...query, url };
}
