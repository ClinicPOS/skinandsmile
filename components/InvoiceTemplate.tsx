import Image from "next/image";

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceTemplateProps {
  invoiceNo: string;
  patientName: string;
  doctorName: string;
  patientPhone?: string;
  items: InvoiceItem[];
  subtotal: number;
  discount?: number;
  vat?: number;
  total: number;
}

export default function InvoiceTemplate({
  invoiceNo,
  patientName,
  doctorName,
  patientPhone,
  items,
  subtotal,
  discount = 0,
  vat = 0,
  total,
}: InvoiceTemplateProps) {
  return (
    <div className="bg-white text-black w-[210mm] min-h-[297mm] mx-auto shadow-lg">

      {/* HEADER */}
      <div className="bg-black text-white px-10 py-8 border-b-4 border-yellow-600">

        <div className="flex justify-between items-start">

          {/* LEFT SIDE */}
          <div>

            <Image
              src="/images/logo.png"
              alt="Skin and Smile Dental Clinic"
              width={180}
              height={180}
              className="mb-5"
            />

            <h1 className="text-4xl font-bold text-yellow-500">
              Skin and Smile Dental Clinic
            </h1>

            <p className="text-xl mt-2">
              عيادة سكين اند سمايل لطب الأسنان
            </p>

          </div>

          {/* RIGHT SIDE */}
          <div className="text-right">

            <h1 className="text-6xl font-bold text-yellow-500">
              INVOICE
            </h1>

            <p className="text-3xl mt-2">
              فاتورة
            </p>

            <div className="mt-10 space-y-3">

              <p>
                <strong>Invoice No:</strong> {invoiceNo}
              </p>

              <p>
                <strong>Date:</strong>{" "}
                {new Date().toLocaleDateString()}
              </p>

              <p>
                <strong>TRN:</strong> __________________
              </p>

            </div>

          </div>

        </div>

      </div>

      {/* DETAILS */}
      <div className="grid grid-cols-2 gap-20 px-10 py-10">

        {/* BILL TO */}
        <div>

          <h2 className="text-2xl font-bold text-yellow-600 mb-5 border-b border-yellow-600 inline-block">
            Bill To / فاتورة إلى
          </h2>

          <div className="space-y-3 mt-4">

            <p>
              <strong>Patient:</strong> {patientName}
            </p>

            <p>
              <strong>Mobile:</strong>{" "}
              {patientPhone || "-"}
            </p>

            <p>
              <strong>Doctor:</strong> {doctorName}
            </p>

          </div>

        </div>

        {/* CLINIC DETAILS */}
        <div>

          <h2 className="text-2xl font-bold text-yellow-600 mb-5 border-b border-yellow-600 inline-block">
            Clinic Details
          </h2>

          <div className="space-y-2">

            <p className="font-bold text-lg">
              Skin and Smile Dental Clinic
            </p>

            <p>Al Satwa, Dubai, UAE</p>

            <p>
              Same Building of Almaya Supermarket
            </p>

            <p>Near Satwa Bus Station</p>

            <p>2nd Floor, Room 207</p>

            <p className="pt-3">
              📞 +971 56 423 4443
            </p>

            <p>
              📞 04 272 5458
            </p>

          </div>

        </div>

      </div>

      {/* TABLE */}
      <div className="px-10">

        <table className="w-full border-collapse">

          <thead>

            <tr className="bg-black text-yellow-500">

              <th className="p-4 text-left">#</th>

              <th className="p-4 text-left">
                Description
              </th>

              <th className="p-4 text-center">
                Qty
              </th>

              <th className="p-4 text-right">
                Unit Price
              </th>

              <th className="p-4 text-right">
                Amount
              </th>

            </tr>

          </thead>

          <tbody>

            {items.map((item, index) => (

              <tr
                key={index}
                className="border border-gray-200"
              >

                <td className="p-4">
                  {index + 1}
                </td>

                <td className="p-4">
                  {item.description}
                </td>

                <td className="p-4 text-center">
                  {item.quantity}
                </td>

                <td className="p-4 text-right">
                  AED {item.unitPrice.toFixed(2)}
                </td>

                <td className="p-4 text-right">
                  AED {(item.quantity * item.unitPrice).toFixed(2)}
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

      {/* TOTALS */}
      <div className="flex justify-end px-10 py-10">

        <div className="w-80 border border-gray-300">

          <div className="flex justify-between p-4 border-b">
            <span>Subtotal</span>
            <span>AED {subtotal.toFixed(2)}</span>
          </div>

          <div className="flex justify-between p-4 border-b">
            <span>Discount</span>
            <span>AED {discount.toFixed(2)}</span>
          </div>

          <div className="flex justify-between p-4 border-b">
            <span>VAT</span>
            <span>AED {vat.toFixed(2)}</span>
          </div>

          <div className="flex justify-between p-4 bg-yellow-500 font-bold text-black text-lg">
            <span>Total Due</span>
            <span>AED {total.toFixed(2)}</span>
          </div>

        </div>

      </div>

      {/* THANK YOU */}
      <div className="px-10 pb-8 text-center">

        <h2 className="text-4xl text-yellow-600 mb-2">
          Thank You!
        </h2>

        <p className="text-lg">
          Your Smile, Our Priority
        </p>

        <p className="mt-2">
          ابتسامتكم أولويتنا
        </p>

      </div>

      {/* FOOTER */}
      <div className="bg-black text-white px-10 py-8">

        <div className="grid grid-cols-2 gap-10">

          <div>

            <h3 className="text-yellow-500 font-bold mb-3">
              Social Media
            </h3>

            <p>TikTok: @skinandsmile</p>

            <p>
              Instagram:
              @skinandsmiledentalclinic
            </p>

            <p>
              Facebook:
              Skin and Smile Dental Clinic Official
            </p>

          </div>

          <div className="text-right">

            <h3 className="text-yellow-500 font-bold mb-3">
              Contact
            </h3>

            <p>+971 56 423 4443</p>

            <p>04 272 5458</p>

            <p>
              Al Satwa, Dubai, UAE
            </p>

          </div>

        </div>

      </div>

    </div>
  );
}