const { google } = require('googleapis');
const path = require('path');
const stream = require('stream');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

async function uploadToDrive(buffer, filename, mimetype) {
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);

  const fileMetadata = {
    name: filename,
    parents: ['1j7dPk2mRBJ7qIkPb4epsbBk_oJ_STtl0'], 
  };

  const media = {
    mimeType: mimetype,
    body: bufferStream,
  };

  const file = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id',
  });

  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const fileUrl = `https://drive.google.com/uc?id=${file.data.id}`;
  return fileUrl;
}

module.exports = { uploadToDrive };