import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onBack: () => void;
}

interface GalleryImage {
  id: string;
  companion_id: string;
  storage_path: string;
  public_url: string;
  prompt: string | null;
  caption: string | null;
  provider: string | null;
  source: string | null;
  created_at: string;
}

export default function Gallery({ onBack }: Props) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    const { data } = await supabase
      .from('companion_images' as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setImages(
        (data as any[]).map((img) => ({
          id: img.id,
          companion_id: img.companion_id,
          storage_path: img.storage_path,
          public_url: img.public_url,
          prompt: img.prompt,
          caption: img.caption,
          provider: img.provider,
          source: img.source,
          created_at: img.created_at,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  async function deleteImage(img: GalleryImage) {
    // Delete from storage
    await supabase.storage.from('media').remove([img.storage_path]);

    // Delete from DB
    await supabase
      .from('companion_images' as any)
      .delete()
      .eq('id', img.id);

    setImages((prev) => prev.filter((i) => i.id !== img.id));
    setConfirmDelete(null);
    setLightbox(null);
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <>
      <style>{`
        .gallery {
          height: 100%;
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .gallery-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          padding-top: 52px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .gallery-back {
          background: none;
          border: none;
          color: var(--text-dim);
          font-size: 20px;
          cursor: pointer;
          padding: 4px;
          opacity: 0.7;
          transition: opacity 0.2s;
        }
        .gallery-back:hover {
          opacity: 1;
        }
        .gallery-title {
          font-family: var(--font-display);
          font-size: 18px;
          color: var(--text-primary);
          letter-spacing: 0.05em;
        }
        .gallery-count {
          font-size: 12px;
          color: var(--text-faint);
          margin-left: auto;
        }
        .gallery-grid {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          align-content: start;
        }
        @media (min-width: 600px) {
          .gallery-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            padding: 16px;
          }
        }
        @media (min-width: 900px) {
          .gallery-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        .gallery-thumb {
          aspect-ratio: 1;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          position: relative;
          border: 1px solid var(--border-subtle);
          transition: border-color 0.2s, transform 0.2s;
        }
        .gallery-thumb:hover {
          border-color: var(--border-light);
          transform: scale(1.02);
        }
        .gallery-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .thumb-provider {
          position: absolute;
          bottom: 4px;
          right: 4px;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 8px;
          background: rgba(0,0,0,0.6);
          color: rgba(255,255,255,0.6);
        }
        .gallery-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--text-faint);
          gap: 8px;
        }
        .gallery-empty-icon {
          font-size: 48px;
          opacity: 0.3;
        }
        .gallery-empty-text {
          font-size: 14px;
          font-style: italic;
        }

        /* Lightbox */
        .lightbox-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(0,0,0,0.92);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .lightbox-close {
          position: absolute;
          top: 16px;
          right: 16px;
          background: none;
          border: none;
          color: rgba(255,255,255,0.6);
          font-size: 28px;
          cursor: pointer;
          z-index: 101;
          padding: 4px 8px;
        }
        .lightbox-close:hover {
          color: white;
        }
        .lightbox-img {
          max-width: 100%;
          max-height: 60vh;
          border-radius: 8px;
          object-fit: contain;
        }
        .lightbox-info {
          margin-top: 16px;
          text-align: center;
          max-width: 500px;
          width: 100%;
        }
        .lightbox-caption {
          font-size: 14px;
          color: rgba(255,255,255,0.8);
          margin-bottom: 8px;
          line-height: 1.4;
        }
        .lightbox-meta {
          display: flex;
          gap: 12px;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          font-size: 12px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 12px;
        }
        .lightbox-prompt-toggle {
          font-size: 11px;
          color: rgba(255,255,255,0.4);
          background: none;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px;
          padding: 4px 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lightbox-prompt-toggle:hover {
          color: rgba(255,255,255,0.7);
          border-color: rgba(255,255,255,0.3);
        }
        .lightbox-prompt {
          margin-top: 8px;
          font-size: 11px;
          color: rgba(255,255,255,0.35);
          font-style: italic;
          line-height: 1.4;
          max-height: 100px;
          overflow-y: auto;
        }
        .lightbox-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 16px;
        }
        .lightbox-btn {
          font-size: 12px;
          padding: 6px 16px;
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.6);
        }
        .lightbox-btn:hover {
          background: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.9);
        }
        .lightbox-btn.delete {
          border-color: rgba(255,80,80,0.3);
          color: rgba(255,80,80,0.6);
        }
        .lightbox-btn.delete:hover {
          background: rgba(255,80,80,0.15);
          color: rgba(255,80,80,0.9);
        }

        /* Delete confirm */
        .delete-confirm {
          margin-top: 12px;
          padding: 12px;
          border-radius: 8px;
          background: rgba(255,80,80,0.1);
          border: 1px solid rgba(255,80,80,0.3);
          text-align: center;
        }
        .delete-confirm-text {
          font-size: 12px;
          color: rgba(255,200,200,0.8);
          margin-bottom: 8px;
        }
        .delete-confirm-btns {
          display: flex;
          gap: 8px;
          justify-content: center;
        }
      `}</style>

      <div className="gallery">
        <div className="gallery-header">
          <button className="gallery-back" onClick={onBack}>
            ←
          </button>
          <span className="gallery-title">Sullivan's Gallery</span>
          {images.length > 0 && (
            <span className="gallery-count">{images.length} image{images.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className="gallery-empty">
            <div className="gallery-empty-text">Loading...</div>
          </div>
        ) : images.length === 0 ? (
          <div className="gallery-empty">
            <div className="gallery-empty-icon">🎨</div>
            <div className="gallery-empty-text">
              No images yet. Ask Sullivan to show you something.
            </div>
          </div>
        ) : (
          <div className="gallery-grid">
            {images.map((img) => (
              <div
                key={img.id}
                className="gallery-thumb"
                onClick={() => { setLightbox(img); setShowPrompt(false); setConfirmDelete(null); }}
              >
                <img src={img.public_url} alt={img.caption || 'Generated image'} loading="lazy" />
                {img.provider && (
                  <span className="thumb-provider">
                    {img.provider === 'dalle' ? 'DALL-E' : 'Gemini'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) setLightbox(null);
        }}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}>
            ×
          </button>

          <img
            className="lightbox-img"
            src={lightbox.public_url}
            alt={lightbox.caption || 'Generated image'}
          />

          <div className="lightbox-info">
            {lightbox.caption && (
              <div className="lightbox-caption">{lightbox.caption}</div>
            )}

            <div className="lightbox-meta">
              <span>{formatDate(lightbox.created_at)}</span>
              <span>{formatTime(lightbox.created_at)}</span>
              {lightbox.provider && (
                <span>via {lightbox.provider === 'dalle' ? 'DALL-E' : 'Gemini'}</span>
              )}
              {lightbox.source && lightbox.source !== 'chat' && (
                <span>{lightbox.source}</span>
              )}
            </div>

            {lightbox.prompt && (
              <>
                <button
                  className="lightbox-prompt-toggle"
                  onClick={() => setShowPrompt(!showPrompt)}
                >
                  {showPrompt ? 'hide prompt' : 'show prompt'}
                </button>
                {showPrompt && (
                  <div className="lightbox-prompt">{lightbox.prompt}</div>
                )}
              </>
            )}

            <div className="lightbox-actions">
              <button
                className="lightbox-btn"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = lightbox.public_url;
                  a.download = `sullivan-${Date.now()}.png`;
                  a.target = '_blank';
                  a.click();
                }}
              >
                Save
              </button>
              <button
                className="lightbox-btn delete"
                onClick={() => setConfirmDelete(lightbox.id)}
              >
                Delete
              </button>
            </div>

            {confirmDelete === lightbox.id && (
              <div className="delete-confirm">
                <div className="delete-confirm-text">Delete this image? This can't be undone.</div>
                <div className="delete-confirm-btns">
                  <button
                    className="lightbox-btn delete"
                    onClick={() => deleteImage(lightbox)}
                  >
                    Yes, delete
                  </button>
                  <button
                    className="lightbox-btn"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
