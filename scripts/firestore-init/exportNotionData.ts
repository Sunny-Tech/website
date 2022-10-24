import fsA  from 'fs'
const fs = fsA.promises

const { Client } = require("@notionhq/client")

const notion = new Client({
  auth: process.env['notionToken'],
})

const outputFile = `${__dirname}/../../data/sessions-speakers-schedule.json`

const getNotionPagesData = async (databaseId: string) => {
  const pagesIds = await getNotionPagesIds(databaseId)
  return await Promise.all(pagesIds.map(async (pageId: string) => {
    return await notion.pages.retrieve({ page_id: pageId })
  }))
}

const getNotionPagesIds = async (database: string, totalPagesIds: string[] = []): Promise<string[]> => {
  const response = await notion.databases.query({
    database_id: database,
  })
  const ids = [...totalPagesIds, ...response.results.map((page: any) => page.id)]
  if (response.has_more) {
    return getNotionPagesIds(database, ids)
  }
  return ids
}

const notionFormatToFlatObject = (pagesData: any) => {
  if (pagesData.length === 0) return []
  const keys = Object.keys(pagesData[0].properties)
  return pagesData.map((data: any) => {
    return keys.reduce((acc: any, key) => {
      const property = data.properties[key]

      switch (property.type) {
        case "title":
          acc[key] = property.title[0]?.plain_text
          break
        case "rich_text":
          acc[key] = property.rich_text[0]?.plain_text
          break
        case "relation":
          acc[key] = property.relation?.map((relation: {id: string}) => relation.id)
          break
        case "date":
          if(property.date) {
            acc[key] = property.date.start
            acc["dateEnd"] = property.date.end
          }
          break
        case "checkbox":
          acc[key] = property.checkbox
          break
        case "multi_select":
          // Not managed
          break
        default:
          console.log("unknown", property)
          break
      }
      return acc
    }, {
      id: data.id,
    })
  })
}
const getSocialHandle = (social: string | null) => {
  if(!social) return null
  if(social.includes("@") || !social.startsWith("http")) return social.replace('@', '')

  return social.split('/').pop()
}

type NotionTrack = {
  id: string
  name: string
  order: number
  isAlone: boolean
}

const OUTSIDE_TRACK_DATE = "2069-"

const syncFromNotion = async (speakerDBId: string, proposalsDBId: string, tracksDBId: string) => {
  console.log('Syncing from Notion')

  console.log('Getting data from notion, speakers')
  const nSpeakers = notionFormatToFlatObject(await getNotionPagesData(speakerDBId))
  const nSpeakersById = nSpeakers.reduce((acc: any, speaker: { id: string }) => {
    acc[speaker.id] = speaker
    return acc
  }, {})
  console.log('Getting data from notion, talks')
  const nTalks = notionFormatToFlatObject(await getNotionPagesData(proposalsDBId))
  const nTracks: NotionTrack[] = notionFormatToFlatObject(await getNotionPagesData(tracksDBId))
    .sort((a: any, b: any) => {
      if (a.order < b.order) return -1
      if (a.order > b.order) return 1
      return 0
    })
  const nTracksById = nTracks.reduce((acc: any, track) => {
    acc[track.id] = track
    return acc
  }, {})
  const tracksAsSchedule = nTracks.filter(track => !track.isAlone).map((track) => {
    return {
      title: track.name,
    }
  })

  console.log('Getting data from notion done!')

  // 1. Remove speaker on notion not present here

  console.log('Formatting output data')
  const outputSpeakers = nSpeakers.reduce((acc: any, notionSpeaker: any) => {
    const twitter = getSocialHandle(notionSpeaker.twitter)
    const github = getSocialHandle(notionSpeaker.github)

    const socials = []
    if(twitter) {
      socials.push({
        name: 'Twitter',
        icon: "twitter",
        link: `https://twitter.com/${twitter}`
      })
    }
    if(github) {
      socials.push({
        name: 'Github',
        icon: "github",
        link: `https://github.com/${github}`
      })
    }

    acc[notionSpeaker.cid] = {
      bio: notionSpeaker.bio,
      company: notionSpeaker.company,
      companyLogoUrl: notionSpeaker.companyLogoUrl,
      country: notionSpeaker.city,
      name: notionSpeaker.name,
      photoUrl: notionSpeaker.photoURL,
      socials: socials,
      shortBio: notionSpeaker.shortBio,
      title: notionSpeaker.title2,
    }

    return acc
  }, {})
  console.log(`Found ${Object.keys(outputSpeakers).length} speakers`)

  const outputSessions = nTalks.reduce((acc: any, talk: any) => {
    acc[talk.cid || talk.id] = {
      title: talk.title,
      complexity: talk.level,
      description: (talk.description || "") + (talk.description2 ? talk.description2 : ""),
      language: "French",
      tags: talk.categories ? [talk.categories] : [],
      speakers: talk.speakers.map((speakerId: string) => nSpeakersById[speakerId].cid),
      presentation: talk.presentation,
      videoId: talk.video || null,
      image: talk.image || null,
      hideInFeedback : talk.hideInFeedback,
      hideTrackTitle: talk.hideTrackTitle,
    }

    return acc
  }, {})
  console.log(`Found ${Object.keys(outputSessions).length} sessions`)


  const schedule: {
    [key: string]: {
      date: string,
      dateReadable: string,
      timeslots: {
        startTime: string,
        endTime: string,
        sessions: {
          items: string[],
        }[]
      }[],
      tracks: {
        title: string,
      }[]
    }
  } = {
    "1": {
      date: "",
      dateReadable: "2020-06-01",
      timeslots: [],
      tracks: [],
    },
  }

  // 1. Sort by date
  console.log('Sorting sessions')
  const sortedSessions = Object.values(nTalks).sort((a: any, b: any) => {
    const aDate = new Date(a.dateEnd)
    const bDate = new Date(b.dateEnd)
    return aDate.getTime() - bDate.getTime()
  })

  // const track = session.track.length ? session.track[0] : "Other"
  // 2. Group by weekday
  console.log('Grouping sessions')
  const groupedSessions = sortedSessions.reduce<Record<string, object[]>>((acc, talk: any) => {
    if(!talk.date) {
      acc[""] = acc[""] || []
      acc[""].push(talk)
      return acc
    }
    const day = new Date(talk.date).toISOString().split('T')[0]
    const track = talk.track.length ? nTracksById[talk.track[0]] : null

    if(track && track.isAlone) {
      // Specific management is talk is track alone should have their own tab
      const realDate = new Date(talk.date).toISOString().split('T')[0]
      const dateMonthDay = realDate!.split('-')[1] + "-" + realDate!.split('-')[2]
      const separateDay = new Date(Date.parse(OUTSIDE_TRACK_DATE + dateMonthDay)).toISOString().split('T')[0]
      if(separateDay){
        acc[separateDay] = acc[separateDay] || []
        // @ts-ignore
        acc[separateDay].push(talk)
      }
      return acc
    }

    // @ts-ignore
    if(!acc[day]) acc[day] = []
    // @ts-ignore
    acc[day].push(talk)
    return acc
  }, {})
  const eventDays = Object.keys(groupedSessions).filter(day => !day.startsWith(OUTSIDE_TRACK_DATE))

  // 3. Group by hour & minutes
  console.log('Grouping sessions by hour')
  const groupedSessionsByHour = Object.entries(groupedSessions).reduce((acc: any, [day, talks]: any) => {
    const groupedByHour = talks.reduce((acc: any, talk: any) => {
      try {
        // @ts-ignore
        const startTime = new Date(talk.date).toISOString().split('T')[1].split(':')
        // @ts-ignore
        const endTime = new Date(talk.dateEnd).toISOString().split('T')[1].split(':')
        // @ts-ignore
        const startHour = parseInt(startTime[0]) +2
        const startMinutes = startTime[1]
        // @ts-ignore
        const endHour = parseInt(endTime[0]) +2
        const endMinutes = endTime[1]
        const startTimeString = `${startHour < 10 ? "0"+startHour : startHour}:${startMinutes}`
        const endTimeString = `${endHour < 10 ? "0" + endHour : endHour}:${endMinutes}`
        if(!acc[startTimeString]) acc[startTimeString] = {
          startTime: startTimeString,
          endTime: endTimeString,
          sessions: []
        }

        // Important stuff happen here to add session in line or vertical, etc
        type TempSessionItems = {
          items: {
            id: string,
            cid: string,
            trackIndex: number
          }[],
          extend ?: number
        }
        const track = talk.track.length ? talk.track[0] : null

        let trackIndex = nTracks.length
        if(track) {
          const trackObject = nTracksById[track]
          if(trackObject.isAlone) {
            trackIndex = 0
          } else {
            trackIndex = parseInt(trackObject.order)
          }

        }

        const items: TempSessionItems = {
          items: [{
            ...talk,
            trackIndex
          }]
        }
        if(talk.extendHeight) {
          items.extend =  parseInt(talk.extendHeight)
        }
        acc[startTimeString].sessions.push(items)

        return acc
      } catch (error) {
        console.log("Error on talk in groupedSessionsByHour", talk)
        console.error(error)
        process.exit(1)
      }
    }, {})
    acc[day] = Object.values(groupedByHour).map(
      (timeslot: any) => {
        // We put the items into an indexed object to have blank & the correct track order
        const sessions = Object.values(timeslot.sessions.reduce((acc: any, session: any) => {

          acc[session.items[0].trackIndex] = {
            ...session,
            items: session.items.map((item: any) => item.cid || item.id)
          }

          // If the first session item is "hideTrackTitle" = not a talk, we remove the empty array to take full width
          if(session.items[0] && session.items[0].extendWidth) {
            nTracks.forEach((track: any) => {
              const extendWidth = parseInt(session.items[0].extendWidth)
              if(track.order > 1 && track.order <= extendWidth || track.isAlone){
                delete acc[track.order]
              }
            })
          }

          return acc
        }, nTracks.reduce((acc: any, track: any) => {
          if(!track.isAlone) {
            acc[track.order] = {
              items: [],
            }
          }
          return acc
        }, {})))

        return {
          ...timeslot,
          sessions: sessions
        }

    })
    return acc
  }, {})

  // 4. Merge as schedule format
  console.log('Merging sessions')
  const dateFormat = { weekday: 'long', month: 'long', day: 'numeric' };
  Object.keys(groupedSessionsByHour).forEach(day => {
    if(day.startsWith(OUTSIDE_TRACK_DATE)) {

      const specificWeekDay = day.split('-')[day.split('-').length - 1]
      // @ts-ignore
      const realDate = eventDays.find(eventDay => eventDay.endsWith(specificWeekDay))

      schedule[day] = {
        date: "tropchaud",
        // @ts-ignore
        dateReadable:  "Extérieur " + new Date(Date.parse(realDate)).toLocaleDateString('fr-FR', dateFormat),
        timeslots: groupedSessionsByHour[day],
        tracks: nTracks.filter(
          (track) => track.isAlone)
          .map((track) => ({
          title: track.name,
        })),
      }
      return
    }

    schedule[day] = {
      date: day,
      // @ts-ignore
      dateReadable:  new Date(Date.parse(day)).toLocaleDateString('fr-FR', dateFormat),
      timeslots: groupedSessionsByHour[day],
      tracks: tracksAsSchedule,
    }
  })

  delete schedule["1"]

  console.log("Formatting output data done!")

  await fs.writeFile(outputFile, JSON.stringify({
    speakers: outputSpeakers,
    sessions: outputSessions,
    schedule: schedule
  }, null, 4))
  console.log("File saved to " + outputFile)
}

const main = async () => {
  if(!process.env['notionSpeakersId'] || !process.env['notionTalksId'] || !process.env['notionToken'] ||
    !process.env['notionTracksId']) {
    console.log("Please set notionToken, notionSpeakersId and notionTalksId env variables")
    process.exit(1)
    return
  }

  await syncFromNotion(process.env['notionSpeakersId'], process.env['notionTalksId'], process.env['notionTracksId'])
}

main()
