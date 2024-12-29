import { WorkerEntrypoint } from "cloudflare:workers";

async function getContentFromKey(db, key) {
  try {
    const ret = await db.get(key);
    await db.delete(key);
    return ret;
  } catch (e) {
    return "";
  }
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateData(sender, to, replyTo, subject, htmlContent, textContent) {
  const errors = [];
  
    // Validate sender
    if (!sender || typeof sender !== 'object') errors.push({ field: 'sender', message: `sender must be an object with properties { name, email } (Received: ${sender})` });
    else {
      if (!sender.name || typeof sender.name !== 'string' || sender.name.trim() === '') errors.push({ field: 'sender.name', message: `sender.name must be a non-empty string (Received: ${sender.name})` });
      if (!sender.email || typeof sender.email !== 'string' || !validateEmail(sender.email)) errors.push({ field: 'sender.email', message: `sender.email must be a valid email address (Received: ${sender.email})` });
    }
  
    // Validate 'to' (recipients)
    if (Array.isArray(to)) {
      to.forEach((recipient, index) => {
        if (typeof recipient !== 'object') errors.push({ field: `to[${index}]`, message: `Each recipient should be an object with properties { name, email } (Received: ${recipient})` });
        else {
          if (!recipient.name || typeof recipient.name !== 'string' || recipient.name.trim() === '') errors.push({ field: `to[${index}].name`, message: `to[i].name must be a non-empty string (Received: ${recipient.name})` });
          if (!recipient.email || typeof recipient.email !== 'string' || !validateEmail(recipient.email)) errors.push({ field: `to[${index}].email`, message: `to[i].email must be a valid email address (Received: ${recipient.email})` });
        }
      });
    } else errors.push({ field: 'to', message: `to should be an array of objects or a single object with properties { name, email } (Received: ${to})` });

    // Validate replyTo
    if (typeof replyTo !== 'object') errors.push({ field: 'replyTo', message: `replyTo must be an object with properties { name, email } (Received: ${replyTo})` });
    else {
      if (!replyTo.name || typeof replyTo.name !== 'string' || replyTo.name.trim() === '') errors.push({ field: 'replyTo.name', message: `replyTo.name must be a non-empty string (Received: ${replyTo.name})` });
      if (!replyTo.email || typeof replyTo.email !== 'string' || !validateEmail(replyTo.email)) errors.push({ field: 'replyTo.email', message: `replyTo.email must be a valid email address (Received: ${replyTo.email})` });
    }
  
    // Validate subject
    if (typeof subject !== 'string' || subject.trim() === '') errors.push({ field: 'subject', message: `subject must be a non-empty string (Received: ${subject})` });
  
    // Return error response if there are validation errors
    if (errors.length > 0) return errors;
    return [];
}

function getBaseEmail(sender, to, replyTo, subject) {
  return {
    sender: {
      name: sender.name,
      email: sender.email,
    },
    to: to.flatMap((recipient) => {
      return { name: recipient.name, email: recipient.email };
    }),
    replyTo: {
      name: replyTo.name,
      email: replyTo.email,
    },
    subject: subject
  };
}

async function sendEmailWithData(data, apiKey) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    });

    console.log(response);

    if (!response.ok) return { erorrs: [{ field: "sending", message: "Error sending the email" }] };
    return { errors: [] };
}

export class EmailWorker extends WorkerEntrypoint {
  // Currently, entrypoints without a named handler are not supported
  async fetch() { return new Response(null, {status: 404}); } 

  async sendEmail(sender, to, replyTo, subject, htmlContent = null, textContent = null) {
    if (!Array.isArray(to)) to = [to];
    if (!replyTo) replyTo = { name: "noreply", email: `noreply@${sender.email?.split("@", 2)[1]}` };
    const errors = validateData(sender, to, replyTo, subject);

    if (typeof htmlContent === "object" && htmlContent.key) htmlContent = await getContentFromKey(this.env.TEMP_KV, htmlContent.key);
    if (typeof textContent === "object" && textContent.key) textContent = await getContentFromKey(this.env.TEMP_KV, textContent.key);

    // Validate content
    if (!htmlContent && !textContent) errors.push({ field: 'content', message: 'Either htmlContent or textContent must be provided and be non-empty' });
    else {
      if (htmlContent && typeof htmlContent !== 'string') errors.push({ field: 'htmlContent', message: `htmlContent must be a string if provided (Received: ${htmlContent})` });
      if (textContent && typeof textContent !== 'string') errors.push({ field: 'textContent', message: `textContent must be a string if provided (Received: ${textContent})` });
    }
    if (errors.length > 0 ) return { errors };

    const data = getBaseEmail(sender, to, replyTo, subject);
    if (textContent) data.textContent = textContent;
    if (htmlContent) data.hemlContent = htmlContent;

    return {...(await sendEmailWithData(data, this.env.BREVO_API_KEY)), warnings: [] };
  }

  async sendEmailFromTemplate(templateId, sender, to, replyTo, subject, params=null) {
    if (!Array.isArray(to)) to = [to];
    if (!replyTo) replyTo = { name: "noreply", email: `noreply@${sender.email?.split("@", 2)[1]}` };
    const errors = validateData(sender, to, replyTo, subject)
    const warnings = [];
    
    if (templateId == 1) {
      if (!params || typeof params !== 'object') {
        errors.push({ field: 'params', message: `params must be an object with properties { htmlContent, title } on template ${templateId} (Received: ${params}` });
      } else {
        if (typeof params.htmlContent === "object" && params.htmlContent.key) params.htmlContent = await getContentFromKey(this.env.TEMP_KV, params.htmlContent.key)
        if (!params.htmlContent || typeof params.htmlContent !== 'string' || params.htmlContent.trim() === '') errors.push({ field: 'params.htmlContent', message: `params.htmlContent name must be a non-empty string on template ${templateId} (Received: ${params.htmlContent})` });
        if (!params.title || typeof params.title !== 'string' || params.title.trim() === '') errors.push({ field: 'params.title', message: `params.title name must be a non-empty string on template ${templateId} (Received: ${params.title})` });
      }
      if (errors.length > 0) return { errors };
      params = { htmlContent: params.htmlContent, title: params.title };
    } else {
      warnings.push({ field: 'templateId', message: `templateId not recognized (Received: ${templateId})` });
    }
    if (warnings.length === 0) templateId = parseInt(templateId);

    const data = getBaseEmail(sender, to, replyTo, subject);
    data.templateId = templateId;
    if (params) data.params = params;

    return {...(await sendEmailWithData(data, this.env.BREVO_API_KEY)), warnings };
  }
}

export default {
  // Currently, entrypoints without a named handler are not supported
  async fetch(request) { return new Response(null, {status: 404}); } 
}