// @ts-nocheck
import admin, {ServiceAccount} from 'firebase-admin'
import {getSpeakersSessionsScheduleSponsorFromUrl} from './getSpeakersSessionsSchedule'
import {TeamMember} from './types'
import { runInParallel } from './runInParallel';

if (!process.env.firebaseServiceAccount) {
  throw new Error("firebaseServiceAccount is not defined")
}
if (!process.env.firebaseServiceAccount.startsWith("{")) {
  throw new Error("firebaseServiceAccount should be a JSON string")
}

if (!process.env.payloadUrl || !process.env.payloadUrl.startsWith("https")) {
  throw new Error("githubWebhookPayload env missing or not a URL")
}

const serviceAccount = JSON.parse(process.env.firebaseServiceAccount)
const url = process.env.payloadUrl

const credential = admin.credential.cert(serviceAccount as ServiceAccount)
admin.initializeApp({ credential })
const firestore = admin.firestore()

firestore.settings({ ignoreUndefinedProperties: true })

export const importSpeakers = async (data: any) => {
  const speakers: { [key: string]: object } = data.speakers
  if (!Object.keys(speakers).length) {
    return Promise.resolve()
  }
  console.log('Importing', Object.keys(speakers).length, 'speakers...')
  const batch = firestore.batch()
  Object.keys(speakers).forEach((speakerId, order) => {
    batch.set(firestore.collection('speakers').doc(speakerId), {
      ...speakers[speakerId],
      order,
    })
  })

  const results = await batch.commit()
  console.log('Imported data for', results.length, 'speakers')
}
export const importSessions = async (data: any) => {
  const docs: { [key: string]: object } = data.sessions
  if (!Object.keys(docs).length) {
    return Promise.resolve()
  }
  console.log('Importing sessions...')
  const batch = firestore.batch()
  Object.keys(docs).forEach((docId) => {
    batch.set(firestore.collection('sessions').doc(docId), docs[docId])
  })
  const results = await batch.commit()
  console.log('Imported data for', results.length, 'sessions')
}

export const importSponsors = async (data: any) => {
  const sponsors: { [key: string]: object } = data.sponsors
  if (!Object.keys(sponsors).length) {
    return Promise.resolve()
  }
  console.log('Importing', Object.keys(sponsors).length, 'sponsors...')
  const batch = firestore.batch()

  Object.keys(sponsors).forEach((sponsorId) => {
    const sponsor = sponsors[Number(sponsorId)];
    if (sponsor) {
      batch.set(firestore.collection('partners').doc(sponsorId), {
        title: sponsor.name,
        order: sponsor.order || 0,
      });

      sponsor.sponsors.forEach((item, id) => {
        batch.set(
          firestore
            .collection('partners')
            .doc(`${sponsorId}`)
            .collection('items')
            .doc(`${id}`.padStart(3, '0')),
          {
            height: 60,
            logoUrl: item.logoUrl,
            name: item.name,
            order: item.order || 0,
            url: item.website,
          }
        );
      });
    } else {
      console.warn(`Missing partner ${sponsorId}`);
    }
  });

  const results = await batch.commit()
  console.log('Imported data for', results.length, 'speakers')
}

export const importSchedule = async (data: any) => {
  try {
    const docs: { [key: string]: object } = data.schedule
    if (!Object.keys(docs).length) {
      return Promise.resolve()
    }
    console.log('Importing schedule...', Object.keys(docs).length)
    const batch = firestore.batch()
    Object.keys(docs).forEach((docId) => {
      console.log("...schedule ", docId)
      batch.set(firestore.collection('schedule').doc(docId), {
        ...docs[docId],
        date: docId,
      })
    })
    await batch.commit()
    console.log('Imported data for', Object.keys(docs).length, 'days')
  } catch (error) {
    console.error('Error importing schedule', error);

    throw error
  }
}

export const importTeam = async (team: TeamMember[]) => {
  if (!Array.isArray(team)) {
    return Promise.resolve()
  }
  console.log('Importing team...')
  const batch = firestore.batch()
  batch.set(firestore.collection('team').doc("0"), {
    title: "Membre"
  })
  team.forEach((member, index) => {
    batch.set(firestore.collection('team/0/members').doc(member.id), {
      name: member.name,
      photo: member.photoUrl,
      photoUrl: member.photoUrl,
      order: index,
      socials: member.socials
    })
  })
  await batch.commit()
  console.log('Imported team data for ' + team.length + ' members')
}

async function deleteCollection(collectionPath: string, batchSize: number = 100) {
  const collectionRef = firestore.collection(collectionPath)
  const query = collectionRef.orderBy('__name__').limit(batchSize)
  const snapshot = await query.get()

  await runInParallel(snapshot.docs, 10, async (doc) => {
    console.log('Deleting document', doc.ref.path);
    await firestore.recursiveDelete(doc.ref)
  })
}


const cleanupScheduleSessionSpeakers = async () => {
  console.log('Cleaning up schedule sessions and speakers...')
  await Promise.all([
    deleteCollection('generatedSchedule'),
    deleteCollection('generatedSessions'),
    deleteCollection('generatedSpeakers')
  ])
  await Promise.all([
    deleteCollection('schedule'),
    deleteCollection('sessions'),
    deleteCollection('speakers'),
    deleteCollection('partners'),
    deleteCollection('team')
  ])
  console.log('Cleanup done')
}

getSpeakersSessionsScheduleSponsorFromUrl(url)
  .then(async (data) => {
    await cleanupScheduleSessionSpeakers()
    // await Promise.all([
    //   importSessions(data),
    //   importSpeakers(data),
    //   importSchedule(data),
    //   importSponsors(data),
    //   importTeam(data.team)
    // ])
    return data
  })
  .then(() => {
    console.log('Finished')
    process.exit()
  })
  .catch((err: Error) => {
    console.log(err)
    process.exit(1)
  })
