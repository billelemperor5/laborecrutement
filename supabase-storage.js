/**
 * Supabase Storage Handler for CV PDF Uploads & Access
 * Laboratoires Nedjma Recrutement
 */

/**
 * Validate selected CV file
 * @param {File} file 
 * @param {string} lang 
 * @returns {object} { valid: boolean, error?: string }
 */
function validateCVFile(file, lang = 'ar') {
    if (!file) {
        return {
            valid: false,
            error: lang === 'ar' ? "يرجى اختيار ملف السيرة الذاتية" : "Veuillez sélectionner un fichier CV"
        };
    }

    // PDF mime type or extension check
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPDF) {
        return {
            valid: false,
            error: lang === 'ar' 
                ? "❌ نوع الملف غير مقبول. يرجى رفع ملف بصيغة PDF فقط." 
                : "❌ Type de fichier invalide. Veuillez importer un fichier PDF uniquement."
        };
    }

    // Maximum size: 5 MB (5 * 1024 * 1024 bytes)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
        return {
            valid: false,
            error: lang === 'ar' 
                ? `❌ حجم الملف كبير جداً (${fileSizeMB} MB). الحد الأقصى المسموح به هو 5 MB.` 
                : `❌ Fichier trop volumineux (${fileSizeMB} MB). La taille maximale autorisée est de 5 MB.`
        };
    }

    return { valid: true };
}

/**
 * Sanitize candidate name for safe filename
 * @param {string} name 
 * @returns {string}
 */
function sanitizeCandidateName(name) {
    if (!name) return 'candidat';
    return name
        .trim()
        .replace(/[\s\/\:\*\?\"\<\>\|]+/g, '_')
        .replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '')
        .substring(0, 30);
}

/**
 * Upload CV PDF to Supabase Storage
 * Path pattern: {timestamp}_{random}_{candidateName}.pdf
 * @param {File} file 
 * @param {string} candidateName 
 * @returns {Promise<object>}
 */
async function uploadCVToSupabase(file, candidateName = '') {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return {
            success: false,
            error: "Supabase client unavailable."
        };
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const safeName = sanitizeCandidateName(candidateName);
    const cvPath = `${timestamp}_${randomStr}_${safeName}.pdf`;

    try {
        const { data, error } = await supabase
            .storage
            .from(SUPABASE_BUCKET)
            .upload(cvPath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: 'application/pdf'
            });

        if (error) {
            console.error("Supabase Storage Upload Error Details:", error);
            let userMsg = error.message || "Failed to upload file to storage.";
            
            const isRLSError = error.statusCode === '403' || 
                               error.statusCode === 403 || 
                               (error.message && (error.message.includes('permission') || error.message.includes('row-level security') || error.message.includes('violates'))) || 
                               error.error === 'Unauthorized';

            if (isRLSError) {
                console.warn("🔒 [Supabase RLS Required] Run this SQL in Supabase SQL Editor:\n\nCREATE POLICY \"Allow public uploads to cv bucket\" ON storage.objects FOR INSERT TO public, anon WITH CHECK (bucket_id = 'cv');\nCREATE POLICY \"Allow reading cv bucket files\" ON storage.objects FOR SELECT TO public, anon WITH CHECK (bucket_id = 'cv');");
                
                userMsg = typeof currentLang !== 'undefined' && currentLang === 'fr' 
                    ? "❌ Erreur de permission Supabase (RLS Policy). Veuillez activer la règle d'autorisation d'envoi pour le bucket 'cv' dans le panneau Supabase."
                    : "❌ خطأ في صلاحيات Supabase (RLS Policy). يرجى إضافة سياسة السماح بالرفع (Insert Policy) لحاوية 'cv' في لوحة تحكم Supabase.";
            } else if (error.message.includes('quota') || error.message.includes('exceeded')) {
                userMsg = typeof currentLang !== 'undefined' && currentLang === 'fr' ? "Quota de stockage dépassé." : "تم تجاوز المساحة التخزينية المتاحة.";
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                userMsg = typeof currentLang !== 'undefined' && currentLang === 'fr' ? "Erreur réseau, veuillez réessayer." : "خطأ في الاتصال بالشبكة، يرجى المحاولة لاحقاً.";
            }

            return {
                success: false,
                error: userMsg
            };
        }

        return {
            success: true,
            cvPath: cvPath,
            cvFileName: file.name,
            cvFileSize: file.size,
            uploadDate: new Date().toISOString()
        };
    } catch (err) {
        console.error("Unexpected upload exception:", err);
        return {
            success: false,
            error: err.message || "حدث خطأ غير متوقع أثناء الرفع / Erreur inattendue lors de l'envoi."
        };
    }
}

/**
 * Generate a Signed URL valid for 60 seconds for viewing/downloading private CV
 * @param {string} cvPath 
 * @param {number} expiresInSeconds 
 * @param {boolean} download 
 * @returns {Promise<string|null>}
 */
async function getCVSignedUrl(cvPath, expiresInSeconds = 60, download = false) {
    if (!cvPath) return null;
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        const options = { expiresIn: expiresInSeconds };
        if (download) {
            options.transform = undefined;
            options.download = true;
        }

        const { data, error } = await supabase
            .storage
            .from(SUPABASE_BUCKET)
            .createSignedUrl(cvPath, expiresInSeconds, download ? { download: true } : undefined);

        if (error) {
            console.error("Error creating signed URL:", error);
            alert("❌ تعذر استخراج رابط السيرة الذاتية (قد يكون الرابط منتهي الصلاحية أو غير موجود) / Impossible de générer le lien du CV.");
            return null;
        }

        return data.signedUrl;
    } catch (err) {
        console.error("Signed URL exception:", err);
        return null;
    }
}

/**
 * Open CV PDF in a new browser tab using 60s Signed URL
 * @param {string} cvPath 
 */
async function viewCVInNewTab(cvPath) {
    if (!cvPath) {
        alert("لا تتوفر سيرة ذاتية لهذا المرشح / Aucun CV disponible pour ce candidat.");
        return;
    }
    const signedUrl = await getCVSignedUrl(cvPath, 60, false);
    if (signedUrl) {
        window.open(signedUrl, '_blank', 'noopener,noreferrer');
    }
}

/**
 * Trigger CV PDF Download using 60s Signed URL
 * @param {string} cvPath 
 * @param {string} originalFileName 
 */
async function downloadCVPdf(cvPath, originalFileName = 'CV_Candidate.pdf') {
    if (!cvPath) {
        alert("لا تتوفر سيرة ذاتية لهذا المرشح / Aucun CV disponible pour ce candidat.");
        return;
    }
    const signedUrl = await getCVSignedUrl(cvPath, 60, true);
    if (signedUrl) {
        const link = document.createElement('a');
        link.href = signedUrl;
        link.download = originalFileName || 'CV_Candidate.pdf';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
